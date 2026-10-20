/**
 * A small DataLink client for the iOS and Android live station stream.
 *
 * The web streams with seisplotjs's `DataLinkConnection`, which cannot load
 * on Hermes (its modules import `util.mjs`, which calls
 * `customElements.define` at import; see `miniseed.ts`). This client speaks
 * the same protocol the same way (DataLink 1.0 over a WebSocket with the
 * "DataLink1.1" sub-protocol, as seisplotjs 3.2.7's `datalink.mjs` does):
 *
 * - every frame is `D` `L`, one byte of header length, the ASCII header,
 *   then any data; a command with data names the data length at the end
 *   of its header;
 * - the client says `ID program:user:pid:arch` and waits for the server's
 *   ID, then `MATCH <len>` + the stream pattern and waits for OK, then
 *   `STREAM` (no reply; packets follow);
 * - each `PACKET streamid pktid hptime hpstart hpend size` frame carries a
 *   miniSEED record, decoded by `miniseed.ts`.
 */
import { decodeMiniSeed, type DecodedSegment } from "./miniseed";

export const DATALINK_WS_SUBPROTOCOL = "DataLink1.1";

/** One DataLink frame: `DL`, the header length, the header, the data. */
export function encodeDataLinkCommand(command: string, data = ""): ArrayBuffer {
  const header = data.length > 0 ? `${command} ${data.length}` : command;
  if (header.length > 255) throw new Error("DataLink header longer than 255 bytes");
  const bytes = new Uint8Array(3 + header.length + data.length);
  bytes[0] = 68; // D
  bytes[1] = 76; // L
  bytes[2] = header.length;
  for (let i = 0; i < header.length; i += 1) bytes[3 + i] = header.charCodeAt(i) & 0xff;
  for (let i = 0; i < data.length; i += 1) {
    bytes[3 + header.length + i] = data.charCodeAt(i) & 0xff;
  }
  return bytes.buffer;
}

export type DataLinkFrame =
  | { kind: "packet"; streamId: string; data: ArrayBuffer }
  | { kind: "response"; type: string; header: string; message: string };

/** A frame from the server, or `null` when it is not a DataLink frame. */
export function parseDataLinkFrame(buffer: ArrayBuffer): DataLinkFrame | null {
  if (buffer.byteLength < 3) return null;
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 68 || bytes[1] !== 76) return null;
  const headerLength = bytes[2] as number;
  let header = "";
  for (let i = 0; i < headerLength && 3 + i < bytes.length; i += 1) {
    header += String.fromCharCode(bytes[3 + i] as number);
  }
  const bodyStart = 3 + headerLength;
  if (header.startsWith("PACKET")) {
    const parts = header.split(" ");
    const size = Number.parseInt(parts[6] ?? "", 10);
    const end = Number.isFinite(size) ? bodyStart + size : buffer.byteLength;
    return {
      kind: "packet",
      streamId: parts[1] ?? "",
      data: buffer.slice(bodyStart, Math.min(end, buffer.byteLength)),
    };
  }
  const type = header.split(" ")[0] ?? "";
  let message = "";
  for (let i = bodyStart; i < bytes.length; i += 1) {
    message += String.fromCharCode(bytes[i] as number);
  }
  return { kind: "response", type, header, message };
}

/** The miniSEED samples a packet carries; nothing for any other format. */
export function segmentsFromPacket(frame: DataLinkFrame): DecodedSegment[] {
  if (frame.kind !== "packet" || !frame.streamId.endsWith("/MSEED")) return [];
  return decodeMiniSeed(frame.data);
}

interface WebSocketLike {
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: (() => void) | null;
  send(data: ArrayBuffer): void;
  close(): void;
}

type WebSocketFactory = (url: string, protocol: string) => WebSocketLike;

const defaultFactory: WebSocketFactory = (url, protocol) =>
  new WebSocket(url, protocol) as unknown as WebSocketLike;

/**
 * Streams the packets of one pattern: hands every decoded segment to
 * `onSegment`, every failure (connection, a refused command, a closed
 * socket) to `onError`. Returns the closer.
 */
export function openDataLinkStream(
  url: string,
  pattern: string,
  onSegment: (segment: DecodedSegment) => void,
  onError: (error: Error) => void,
  createSocket: WebSocketFactory = defaultFactory,
): () => void {
  let closed = false;
  let step: "id" | "match" | "stream" = "id";
  const socket = createSocket(url, DATALINK_WS_SUBPROTOCOL);
  socket.binaryType = "arraybuffer";
  const fail = (error: Error) => {
    if (closed) return;
    closed = true;
    onError(error);
    socket.close();
  };
  socket.onopen = () => {
    const pid = Math.floor(Math.random() * 65534) + 1;
    socket.send(encodeDataLinkCommand(`ID bumelerze:app:${pid}:javascript`));
  };
  socket.onmessage = (event) => {
    if (closed || !(event.data instanceof ArrayBuffer)) return;
    const frame = parseDataLinkFrame(event.data);
    if (!frame) return fail(new Error("DataLink frame did not start with DL"));
    if (frame.kind === "packet") {
      try {
        for (const segment of segmentsFromPacket(frame)) onSegment(segment);
      } catch (error) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }
    if (frame.type === "ERROR") return fail(new Error(`DataLink: ${frame.message}`));
    if (step === "id" && frame.type === "ID") {
      step = "match";
      socket.send(encodeDataLinkCommand("MATCH", pattern));
    } else if (step === "match" && frame.type === "OK") {
      step = "stream";
      socket.send(encodeDataLinkCommand("STREAM"));
    }
  };
  socket.onerror = () => fail(new Error("DataLink connection failed"));
  socket.onclose = () => fail(new Error("DataLink connection closed"));
  return () => {
    if (closed) return;
    closed = true;
    socket.close();
  };
}
