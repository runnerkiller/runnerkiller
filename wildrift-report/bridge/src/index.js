import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadEnvFile } from "./env.js";
import { buildConfig } from "./config.js";
import { createDiscordClient } from "./discordClient.js";
import { createAuthService } from "./auth/authService.js";
import { createAuditRepository } from "./repositories/auditRepository.js";
import { createConfigRepository } from "./repositories/configRepository.js";
import { createReportRepository } from "./repositories/reportRepository.js";
import { createUserRepository } from "./repositories/userRepository.js";
import { createVerificationRepository } from "./repositories/verificationRepository.js";
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
  console.error(
    "\nbridge/.env.example을 복사해 bridge/.env를 만들고 값을 채우세요.",
  );
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

const auditRepository = config.discord.channels.auditLog
  ? createAuditRepository({
      discordClient,
      channelId: config.discord.channels.auditLog,
    })
  : null;

const userRepository = config.discord.channels.users
  ? createUserRepository({
      discordClient,
      channelId: config.discord.channels.users,
      onInvalidRecord: (error, message) =>
        console.warn(
          `사용자 메시지 ${message?.id ?? "?"}를 건너뜁니다:`,
          error.message,
        ),
    })
  : null;

const verificationRepository =
  config.discord.channels.verifications && userRepository && auditRepository
    ? createVerificationRepository({
        discordClient,
        channelId: config.discord.channels.verifications,
        userRepository,
        auditRepository,
        onInvalidRecord: (error, message) =>
          console.warn(
            `인증 메시지 ${message?.id ?? "?"}를 건너뜁니다:`,
            error.message,
          ),
      })
    : null;

const reportRepository =
  config.discord.channels.reportsPending &&
  config.discord.channels.reportsApproved
    ? createReportRepository({
        discordClient,
        pendingChannelId: config.discord.channels.reportsPending,
        approvedChannelId: config.discord.channels.reportsApproved,
        rejectedChannelId: config.discord.channels.reportsRejected,
        auditRepository,
        onInvalidRecord: (error, message) =>
          console.warn(
            `제보 메시지 ${message?.id ?? "?"}를 건너뜁니다:`,
            error.message,
          ),
      })
    : null;

const oauthReady = Boolean(
  config.discord.clientId &&
    config.discord.clientSecret &&
    config.bridgePublicUrl &&
    config.publicSiteOrigin &&
    config.sessionSigningSecret &&
    config.discord.guildId &&
    config.discord.adminRoleId,
);

const authService = oauthReady
  ? createAuthService({
      clientId: config.discord.clientId,
      clientSecret: config.discord.clientSecret,
      bridgePublicUrl: config.bridgePublicUrl,
      publicSiteOrigin: config.publicSiteOrigin,
      sessionSecret: config.sessionSigningSecret,
      guildId: config.discord.guildId,
      adminRoleId: config.discord.adminRoleId,
      discordClient,
    })
  : null;

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
  configRepository,
  reportRepository,
  userRepository,
  verificationRepository,
  auditRepository,
  authService,
  devReporterDiscordId: config.devReporterDiscordId,
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
