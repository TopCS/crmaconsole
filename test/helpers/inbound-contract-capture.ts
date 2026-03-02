import { buildDispatchInboundCaptureMock } from "./dispatch-inbound-capture.js";

// Define locally since original module was removed
type MsgContext = {
  senderId: string;
  channelId: string;
  chatId: string;
  text: string;
  [key: string]: unknown;
};

export type InboundContextCapture = {
  ctx: MsgContext | undefined;
};

export function createInboundContextCapture(): InboundContextCapture {
  return { ctx: undefined };
}

export async function buildDispatchInboundContextCapture(
  importOriginal: <T extends Record<string, unknown>>() => Promise<T>,
  capture: InboundContextCapture,
) {
  const actual = await importOriginal<Record<string, unknown>>();
  return buildDispatchInboundCaptureMock(
    actual as { dispatchInbound?: (ctx: unknown) => Promise<void> },
    (ctx) => {
      capture.ctx = ctx as MsgContext;
    },
  );
}
