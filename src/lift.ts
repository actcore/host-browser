/**
 * Custom lift logic for jco-transpiled wasip3-async task-return values.
 *
 * Background: jco 1.19's `_liftFlatRecord` (used in async task-return paths
 * for `act:tools/tool-provider`'s exported functions) assumes the wasm
 * passes a single "storage pointer" param and reads record fields out of
 * linear memory at that pointer. The actual wasip3-async canonical ABI
 * passes the record's fields *flat* in params, e.g.
 *
 *   list-tools task-return:
 *     params = [resultTag, metadata.ptr, metadata.len, tools.ptr, tools.len, ...pad]
 *
 *   call-tool task-return:
 *     params = [toolResultTag, events.ptr, events.len, ...pad]   (for `immediate`)
 *     params = [toolResultTag, stream-handle, ...pad]            (for `streaming`)
 *
 * We bypass jco's lift entirely for the two `act:tools` exports and walk
 * the records out of linear memory ourselves.
 *
 * Caller selects which decoder to use via `globalThis.__actcoreExpect`
 * (set to `'list-tools'` or `'call-tool'` immediately before invoking).
 *
 * This is a stopgap until the underlying jco bug is fixed upstream — see
 * tracking issue at https://github.com/bytecodealliance/jco/issues/... (TODO).
 */
export function customLiftSource(): string {
  return `
    // @actcore/host: bypass jco's flat-fields lift for act:tools task-return.
    // Selected at runtime via globalThis.__actcoreExpect = 'list-tools' | 'call-tool'.
    try {
      if (memory && liftFns.length === 1) {
        const m = memory.buffer;
        const dv = new DataView(m);
        const td = new TextDecoder();
        const readStr = (p, l) => td.decode(new Uint8Array(m, p, l));
        const expect = globalThis.__actcoreExpect;

        if (expect === 'list-tools' && params.length >= 5) {
          const tag = params[0];
          if (tag !== 0) throw new Error('list-tools returned err tag');
          const toolsPtr = params[3];
          const toolsLen = params[4];
          const tools = [];
          const TOOL_SIZE = 36; // canonical ABI: name(8) + desc-variant(12) + schema(8) + metadata(8)
          for (let i = 0; i < toolsLen; i++) {
            const base = toolsPtr + i * TOOL_SIZE;
            const namePtr = dv.getUint32(base + 0, true);
            const nameLen = dv.getUint32(base + 4, true);
            const descTag = dv.getUint32(base + 8, true);
            const descPtr = dv.getUint32(base + 12, true);
            const descLen = dv.getUint32(base + 16, true);
            const schemaPtr = dv.getUint32(base + 20, true);
            const schemaLen = dv.getUint32(base + 24, true);
            tools.push({
              name: readStr(namePtr, nameLen),
              description: descTag === 0
                ? { tag: 'plain', val: readStr(descPtr, descLen) }
                : { tag: 'localized', val: [] }, // TODO: walk localized list
              parametersSchema: readStr(schemaPtr, schemaLen),
              metadata: [], // TODO: walk metadata list
            });
          }
          task.resolve([{ tag: 'ok', val: { metadata: [], tools } }]);
          return;
        }

        if (expect === 'call-tool') {
          // ToolResult flat: [variantTag, eventsPtr|streamHdl, eventsLen|—]
          const trTag = params[0];
          if (trTag === 0) {
            const evPtr = params[1];
            const evLen = params[2];
            const events = [];
            const EV_STRIDE = 32; // canonical ABI: u8 tag (padded to 4) + content-part 28
            for (let i = 0; i < evLen; i++) {
              const base = evPtr + i * EV_STRIDE;
              const evTag = dv.getUint8(base);
              if (evTag === 0) {
                // content-part: data.ptr(4) data.len(8) mimeTag(12) mime.ptr(16) mime.len(20) meta.ptr(24) meta.len(28)
                const dataPtr = dv.getUint32(base + 4, true);
                const dataLen = dv.getUint32(base + 8, true);
                const mimeTag = dv.getUint8(base + 12);
                const mimePtr = dv.getUint32(base + 16, true);
                const mimeLen = dv.getUint32(base + 20, true);
                const mime = mimeTag === 1 ? readStr(mimePtr, mimeLen) : null;
                events.push({
                  tag: 'content',
                  val: {
                    data: new Uint8Array(m, dataPtr, dataLen).slice(),
                    mimeType: mime,
                    metadata: [],
                  },
                });
              } else {
                events.push({
                  tag: 'error',
                  val: { kind: 'std:internal', message: { tag: 'plain', val: '[unparsed tool-event tag=' + evTag + ']' }, metadata: [] },
                });
              }
            }
            task.resolve([{ tag: 'immediate', val: events }]);
            return;
          } else {
            throw new Error('@actcore/host: streaming tool-result not yet supported');
          }
        }
      }
    } catch (e) {
      throw new Error('@actcore/host custom lift failed: ' + (e && e.message ? e.message : e));
    }
  `;
}
