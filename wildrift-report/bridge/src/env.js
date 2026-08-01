import { readFileSync } from "node:fs";

/**
 * 아주 작은 .env 파서. dotenv 의존성을 추가하지 않기 위해 직접 구현했다.
 *
 * 값에 들어간 `#`을 주석으로 처리하지 않는다. 봇 토큰이나 서명 키에 `#`이
 * 들어가도 잘리지 않게 하기 위해서다. 주석은 줄 맨 앞에서만 인식한다.
 */
export function parseEnv(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice(7) : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(eq + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
        if (first === '"') value = value.replace(/\\n/g, "\n");
      }
    }
    result[key] = value;
  }
  return result;
}

/**
 * .env 파일을 읽어 process.env에 채운다. 이미 설정된 환경변수는 덮어쓰지 않는다.
 * 파일이 없으면 조용히 넘어간다 (CI나 컨테이너에서는 환경변수를 직접 주입한다).
 */
export function loadEnvFile(path, env = process.env) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { loaded: false, keys: [] };
  }

  const parsed = parseEnv(text);
  const keys = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) {
      env[key] = value;
      keys.push(key);
    }
  }
  return { loaded: true, keys };
}
