import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadEnvFile } from "./env.js";
import { buildConfig } from "./config.js";
import { createDiscordClient } from "./discordClient.js";
import { createConfigRepository } from "./repositories/configRepository.js";
import { createHealthService } from "./health.js";
import { createServer } from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));
loadEnvFile(join(here, "..", ".env"));

const config = buildConfig(process.env);

if (!config.ok) {
  console.error("환경변수 설정에 문제가 있어 시작할 수 없습니다:\n");
  for (const problem of config.errors) {
    console.error(`  - ${problem.key}: ${problem.message}`);
  }
  console.error("\nbridge/.env.example을 복사해 bridge/.env를 만들고 값을 채우세요.");
  console.error("설정 방법은 bridge/README.md를 참고하세요.");
  process.exit(1);
}

for (const warning of config.warnings) {
  console.warn(`경고: ${warning}`);
}

const discordClient = createDiscordClient({ token: config.discord.botToken });

const configRepository = createConfigRepository({
  discordClient,
  channelId: config.discord.channels.config,
  messageId: config.discord.configMessageId,
});

const healthService = createHealthService({
  discordClient,
  configRepository,
  setup: {
    missingByStage: config.missingByStage,
    warnings: config.warnings,
  },
});

const server = createServer({
  healthService,
  publicSiteOrigin: config.publicSiteOrigin,
  onError: (error) => console.error("요청 처리 중 오류:", error),
});

server.listen(config.port, () => {
  console.log(`Bridge가 http://localhost:${config.port} 에서 실행 중입니다.`);
  console.log(`상태 확인: http://localhost:${config.port}/health`);
  if (config.publicSiteOrigin) {
    console.log(`허용된 웹사이트 출처: ${config.publicSiteOrigin}`);
  }
  const pending = Object.entries(config.missingByStage);
  if (pending.length > 0) {
    console.log("\n아직 설정하지 않은 값 (해당 단계 구현 시 필요):");
    for (const [stage, keys] of pending.sort((a, b) => a[0] - b[0])) {
      console.log(`  ${stage}단계: ${keys.join(", ")}`);
    }
  }
});

function shutdown(signal) {
  console.log(`\n${signal} 신호를 받아 종료합니다.`);
  server.close(() => process.exit(0));
  // 연결이 남아 있어도 오래 붙잡지 않는다.
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
