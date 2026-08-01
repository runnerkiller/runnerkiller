(function () {
  const { useState, useEffect, useMemo, useRef } = React;
  const {
    C,
    CATS,
    CAT_KEYS,
    MODES,
    NICK_RE,
    ID_RE,
    ACC_COLOR,
    ACC_LABEL,
    STATUS_LABEL,
    STATUS_COLOR,
  } = WR;
  const { store, shotKey, verifyKey } = WR;
  const { scanPII, fmtDate, fmtDateTime, compress, hashPass } = WR;
  const { SinglePhotoPicker } = window;
  function LoginForm({ onLogin, allowSignup = true }) {
    const [userId, setUserId] = useState("");
    const [pass, setPass] = useState("");
    const [gameNickname, setGameNickname] = useState("");
    const [verifyShot, setVerifyShot] = useState(null);
    const [mode, setMode] = useState("login");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const submit = async () => {
      setError("");
      if (!ID_RE.test(userId)) {
        setError("아이디는 영문·숫자·밑줄 3~16자여야 합니다.");
        return;
      }
      if (pass.length < 4) {
        setError("비밀번호는 4자 이상이어야 합니다.");
        return;
      }
      if (mode === "signup") {
        if (!NICK_RE.test(gameNickname)) {
          setError("와일드 리프트 게임 닉네임을 2~20자로 입력해 주세요.");
          return;
        }
        if (!verifyShot) {
          setError("본인 게임 프로필 화면 스크린샷을 첨부해 주세요.");
          return;
        }
      }
      setBusy(true);
      try {
        await onLogin(
          userId.trim(),
          pass,
          mode,
          gameNickname.trim(),
          verifyShot,
        );
      } catch (e) {
        setError(
          e && e.message
            ? e.message
            : "처리에 실패했습니다. 다시 시도해 주세요.",
        );
      } finally {
        setBusy(false);
      }
    };

    const fieldStyle = {
      backgroundColor: C.bg,
      border: `1px solid ${C.line}`,
      color: C.text,
    };

    return (
      <div className="px-4 py-6">
        <div className="flex" style={{ borderBottom: `1px solid ${C.line}` }}>
          {(allowSignup ? ["login", "signup"] : ["login"]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setError("");
              }}
              className="flex-1 pb-2 text-sm font-semibold"
              style={{
                color: mode === m ? C.gold : C.muted,
                borderBottom: `2px solid ${mode === m ? C.gold : "transparent"}`,
              }}
            >
              {m === "login" ? "로그인" : "회원가입"}
            </button>
          ))}
        </div>

        {!allowSignup && (
          <p
            className="mt-4 rounded p-3 text-xs"
            style={{ backgroundColor: `${C.gold}12`, color: C.gold }}
          >
            현재 신규 회원가입은 비활성화되어 있습니다.
          </p>
        )}

        {mode === "signup" && (
          <p
            className="mt-4 rounded p-3 text-xs leading-relaxed"
            style={{
              backgroundColor: `${C.gold}12`,
              border: `1px solid ${C.gold}44`,
            }}
          >
            와일드 리프트 게임 닉네임과 본인 프로필 화면 스크린샷을 함께 제출해
            주세요. 운영자가 확인 후 승인해야 평가(추천/비추천) 기능을 쓸 수
            있습니다. 자동 계정 대조가 아닌 육안 검수 방식이라 시간이 걸릴 수
            있습니다.
          </p>
        )}

        <label
          className="mt-4 block font-mono text-xs tracking-widest"
          style={{ color: C.muted }}
        >
          아이디
        </label>
        <input
          className="mt-2 w-full rounded px-3 py-2 font-mono text-sm outline-none"
          style={fieldStyle}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="영문·숫자 3~16자"
        />

        <label
          className="mt-4 block font-mono text-xs tracking-widest"
          style={{ color: C.muted }}
        >
          비밀번호
        </label>
        <input
          type="password"
          className="mt-2 w-full rounded px-3 py-2 text-sm outline-none"
          style={fieldStyle}
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="4자 이상"
        />

        {mode === "signup" && (
          <>
            <label
              className="mt-4 block font-mono text-xs tracking-widest"
              style={{ color: C.muted }}
            >
              와일드 리프트 게임 닉네임
            </label>
            <input
              className="mt-2 w-full rounded px-3 py-2 font-mono text-sm outline-none"
              style={fieldStyle}
              value={gameNickname}
              onChange={(e) => setGameNickname(e.target.value)}
              maxLength={20}
              placeholder="게임 내 표시 이름"
            />

            <label
              className="mt-4 block font-mono text-xs tracking-widest"
              style={{ color: C.muted }}
            >
              본인 인증 스크린샷
            </label>
            <div className="mt-2">
              <SinglePhotoPicker
                value={verifyShot}
                onChange={setVerifyShot}
                label="게임 내 프로필 화면 (닉네임이 보이는 사진)"
              />
            </div>
          </>
        )}

        {error && (
          <p
            className="mt-3 rounded p-2 text-xs"
            style={{ backgroundColor: `${C.danger}18`, color: C.danger }}
          >
            {error}
          </p>
        )}

        <button
          onClick={submit}
          disabled={busy}
          className="mt-5 w-full rounded py-3 text-sm font-bold"
          style={{
            backgroundColor: busy ? C.line : C.gold,
            color: busy ? C.muted : C.bg,
          }}
        >
          {busy ? "처리 중…" : mode === "login" ? "로그인" : "인증 요청 보내기"}
        </button>

        <p className="mt-4 text-xs leading-relaxed" style={{ color: C.muted }}>
          데모용 저장 방식이라 비밀번호를 서버급으로 안전하게 보관하지 않으며,
          게임 계정 인증도 라이엇 공식 API 대조가 아닌 운영자 육안 검수입니다.
          실제 서비스 전환 시 정식 인증 시스템으로 옮겨야 합니다.
        </p>
      </div>
    );
  }

  window.LoginForm = LoginForm;
})();
