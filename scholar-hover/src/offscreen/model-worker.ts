import { generatePaper } from '../background/model';
import type { ModelCommand } from '../background/long-model';

interface ModelWorkerReply {
  requestId: string;
  ok: boolean;
  data?: Awaited<ReturnType<typeof generatePaper>>;
  error?: string;
}

self.addEventListener('message', (event: MessageEvent<ModelCommand>) => {
  const command = event.data;
  if (command?.target !== 'scholar-hover-offscreen' || command.type !== 'GENERATE_MODEL') return;
  void generatePaper(command.paper, command.settings, command.apiKey).then(
    data => self.postMessage({ requestId: command.requestId, ok: true, data } satisfies ModelWorkerReply),
    error => self.postMessage({ requestId: command.requestId, ok: false,
      error: error instanceof Error ? error.message.slice(0, 300) : '模型请求失败，请重试。' } satisfies ModelWorkerReply),
  );
});
