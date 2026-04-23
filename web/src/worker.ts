/// <reference lib="webworker" />

import { parse, type ParseResult } from './pipeline/markdown.js';

export interface WorkerRequest {
  id: number;
  source: string;
}

export interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: ParseResult;
  error?: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (ev: MessageEvent<WorkerRequest>) => {
  const { id, source } = ev.data;
  try {
    const result = parse(source);
    const response: WorkerResponse = { id, ok: true, result };
    ctx.postMessage(response);
  } catch (err) {
    const response: WorkerResponse = {
      id,
      ok: false,
      error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
    };
    ctx.postMessage(response);
  }
});