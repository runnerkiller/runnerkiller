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
  const { Chip, Evidence, ReporterTag } = window;
  const { scanPII, fmtDate, fmtDateTime, norm } = WR;
  function AdminReportCard({ r, onDecide, onDelete }) {
    const flags = scanPII(r.description);
    return (
      <div
        className="mt-4 rounded p-4"
        style={{ backgroundColor: C.surface, border: `1px solid ${C.line}` }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{r.nickname}</span>
          <Chip color={CATS[r.category].color} solid>
            {CATS[r.category].label}
          </Chip>
          {r.tags.map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
          <Chip color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Chip>
          {!r.hasEvidence && <Chip color={C.danger}>증거 없음</Chip>}
          <span
            className="ml-auto font-mono text-xs"
            style={{ color: C.muted }}
          >
            {fmtDate(r.occurredAt)} · {r.mode}
          </span>
        </div>
        <div className="mt-2">
          <ReporterTag r={r} />
        </div>
        <p className="mt-3 text-sm leading-relaxed">{r.description}</p>
        <Evidence reportId={r.id} evidence={r.evidence} />
        {flags.length > 0 && (
          <p
            className="mt-3 rounded p-2 text-xs"
            style={{ backgroundColor: `${C.danger}18`, color: C.danger }}
          >
            신상 정보 의심: {flags.map((f) => f.label).join(", ")}
          </p>
        )}
        <p className="mt-2 font-mono text-xs" style={{ color: C.muted }}>
          등록: {fmtDateTime(r.createdAt)}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            onClick={() => onDecide(r.id, "approved")}
            disabled={r.status === "approved"}
            className="rounded py-2.5 text-xs font-bold disabled:opacity-40"
            style={{ backgroundColor: C.abuse, color: C.bg }}
          >
            공개 승인
          </button>
          <button
            onClick={() => onDecide(r.id, "rejected")}
            disabled={r.status === "rejected"}
            className="rounded py-2.5 text-xs font-bold disabled:opacity-40"
            style={{
              backgroundColor: "transparent",
              color: C.danger,
              border: `1px solid ${C.danger}`,
            }}
          >
            반려
          </button>
          <button
            onClick={() => onDelete(r.id)}
            className="rounded py-2.5 text-xs font-bold"
            style={{
              backgroundColor: "transparent",
              color: C.muted,
              border: `1px solid ${C.line}`,
            }}
          >
            영구 삭제
          </button>
        </div>
      </div>
    );
  }

  /* ============================ 관리자: 계정 인증 대기 ============================ */
  function AdminVerify({ accounts, onDecide }) {
    const pending = Object.entries(accounts).filter(
      ([, a]) => a.status === "pending",
    );
    if (!pending.length)
      return (
        <p className="mt-8 text-center text-sm" style={{ color: C.muted }}>
          인증 대기 중인 계정이 없습니다.
        </p>
      );

    return (
      <div className="mt-4 space-y-3">
        {pending.map(([id, acc]) => (
          <VerifyCard key={id} userId={id} acc={acc} onDecide={onDecide} />
        ))}
      </div>
    );
  }

  function VerifyCard({ userId, acc, onDecide }) {
    const [shot, setShot] = useState(null);
    useEffect(() => {
      let alive = true;
      (async () => {
        const res = await store.get(verifyKey(userId), true);
        if (alive) setShot(res ? res.value : null);
      })();
      return () => {
        alive = false;
      };
    }, [userId]);

    return (
      <div
        className="rounded p-3"
        style={{ backgroundColor: C.surface, border: `1px solid ${C.line}` }}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{userId}</span>
          <span className="text-xs" style={{ color: C.muted }}>
            게임 닉네임:
          </span>
          <span className="font-mono text-sm" style={{ color: C.gold }}>
            {acc.gameNickname}
          </span>
        </div>
        {shot ? (
          <img
            src={shot}
            alt="인증 스크린샷"
            className="mt-3 max-h-64 rounded object-contain"
            style={{ border: `1px solid ${C.line}` }}
          />
        ) : (
          <p className="mt-3 text-xs" style={{ color: C.muted }}>
            스크린샷 불러오는 중…
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => onDecide(userId, "approved")}
            className="rounded py-2.5 text-xs font-bold"
            style={{ backgroundColor: C.abuse, color: C.bg }}
          >
            인증 승인
          </button>
          <button
            onClick={() => onDecide(userId, "rejected")}
            className="rounded py-2.5 text-xs font-bold"
            style={{
              backgroundColor: "transparent",
              color: C.danger,
              border: `1px solid ${C.danger}`,
            }}
          >
            인증 거절
          </button>
        </div>
      </div>
    );
  }

  function AdminUsers({
    accounts,
    onToggleBan,
    onDeleteAccount,
    onResetVotes,
  }) {
    const list = Object.entries(accounts).sort(
      (a, b) => (b[1].voted?.length || 0) - (a[1].voted?.length || 0),
    );
    if (!list.length)
      return (
        <p className="mt-6 text-center text-sm" style={{ color: C.muted }}>
          가입된 계정이 없습니다.
        </p>
      );

    return (
      <div className="mt-4 space-y-2">
        {list.map(([id, acc]) => (
          <div
            key={id}
            className="rounded p-3"
            style={{
              backgroundColor: C.surface,
              border: `1px solid ${C.line}`,
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold">{id}</span>
              <Chip color={ACC_COLOR[acc.status]}>{ACC_LABEL[acc.status]}</Chip>
              {acc.gameNickname && (
                <span className="font-mono text-xs" style={{ color: C.muted }}>
                  ({acc.gameNickname})
                </span>
              )}
              {acc.banned && (
                <Chip color={C.danger} solid>
                  정지됨
                </Chip>
              )}
              <span
                className="ml-auto font-mono text-xs"
                style={{ color: C.muted }}
              >
                평가 {acc.voted?.length || 0}건
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                onClick={() => onToggleBan(id)}
                className="rounded py-2 text-xs font-bold"
                style={{
                  backgroundColor: acc.banned ? C.abuse : "transparent",
                  color: acc.banned ? C.bg : C.danger,
                  border: `1px solid ${acc.banned ? C.abuse : C.danger}`,
                }}
              >
                {acc.banned ? "정지 해제" : "계정 정지"}
              </button>
              <button
                onClick={() => onResetVotes(id)}
                className="rounded py-2 text-xs font-bold"
                style={{
                  backgroundColor: "transparent",
                  color: C.muted,
                  border: `1px solid ${C.line}`,
                }}
              >
                평가 기록 초기화
              </button>
              <button
                onClick={() => onDeleteAccount(id)}
                className="rounded py-2 text-xs font-bold"
                style={{
                  backgroundColor: "transparent",
                  color: C.muted,
                  border: `1px solid ${C.line}`,
                }}
              >
                계정 삭제
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const FEATURE_FLAG_META = {
    publicList: ["공개 명단", "승인된 제보 명단과 검색을 노출합니다."],
    reportSubmission: [
      "제보 제출",
      "사용자가 새 제보를 등록할 수 있게 합니다.",
    ],
    evidenceUpload: [
      "증거 사진 첨부",
      "제보 작성 시 최대 3장의 사진을 첨부할 수 있게 합니다.",
    ],
    evidenceRequired: ["증거 사진 필수", "사진이 없는 제보 제출을 차단합니다."],
    authentication: ["로그인", "로그인 탭과 사용자 세션을 활성화합니다."],
    signup: ["회원가입", "새 계정과 게임 계정 인증 요청을 받습니다."],
    voting: ["신뢰함·의심됨 평가", "인증된 사용자의 제보 평가를 활성화합니다."],
    reporterIdentity: [
      "제보자 닉네임 공개",
      "제보자가 인증된 게임 닉네임을 표시할 수 있게 합니다.",
    ],
  };

  function AdminFeatureFlags({ featureFlags, onChange }) {
    return (
      <div className="mt-4 space-y-2">
        <p
          className="rounded p-3 text-xs leading-relaxed"
          style={{
            backgroundColor: `${C.gold}12`,
            border: `1px solid ${C.gold}44`,
            color: C.muted,
          }}
        >
          디버깅용 기능 스위치입니다. 변경 즉시 저장되며 사용자 화면에
          반영됩니다.
        </p>
        {Object.entries(FEATURE_FLAG_META).map(
          ([key, [label, description]]) => {
            const active = featureFlags[key];
            const disabled =
              key === "evidenceRequired" && !featureFlags.evidenceUpload;
            return (
              <button
                key={key}
                disabled={disabled}
                onClick={() => onChange(key, !active)}
                className="flex w-full items-center gap-3 rounded p-3 text-left disabled:opacity-40"
                style={{
                  backgroundColor: C.surface,
                  border: `1px solid ${active ? C.abuse : C.line}`,
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{label}</span>
                  <span
                    className="mt-1 block text-xs leading-relaxed"
                    style={{ color: C.muted }}
                  >
                    {description}
                  </span>
                </span>
                <span
                  className="shrink-0 rounded-full px-2.5 py-1 font-mono text-xs font-bold"
                  style={{
                    backgroundColor: active ? C.abuse : C.line,
                    color: active ? C.bg : C.muted,
                  }}
                >
                  {active ? "ON" : "OFF"}
                </span>
              </button>
            );
          },
        )}
      </div>
    );
  }

  function AdminDebugTools({
    reports,
    accounts,
    onSeedDemoData,
    onRemoveDemoData,
    onResetFeatureFlags,
    onResetAllLocalData,
  }) {
    const [busy, setBusy] = useState("");
    const [message, setMessage] = useState("");
    const demoReportCount = reports.filter((r) =>
      r.id.startsWith("demo-report-"),
    ).length;
    const demoAccountCount = Object.keys(accounts).filter((id) =>
      id.startsWith("demo_"),
    ).length;

    const run = async (name, action) => {
      setBusy(name);
      setMessage("");
      try {
        await action();
        setMessage(`${name} 완료`);
      } catch (error) {
        setMessage(error?.message || `${name} 실패`);
      } finally {
        setBusy("");
      }
    };

    return (
      <div className="mt-4 space-y-3">
        <div
          className="rounded p-3 text-xs leading-relaxed"
          style={{
            backgroundColor: `${C.hack}14`,
            border: `1px solid ${C.hack}44`,
            color: C.muted,
          }}
        >
          현재 샘플 제보 {demoReportCount}건 · 샘플 계정 {demoAccountCount}개
          <br />
          인증 계정: <span className="font-mono">demo_approved</span>
          <br />
          비밀번호: <span className="font-mono">demo1234</span>
        </div>

        <button
          disabled={!!busy}
          onClick={() => run("샘플 데이터 생성", onSeedDemoData)}
          className="w-full rounded py-3 text-sm font-bold disabled:opacity-40"
          style={{ backgroundColor: C.abuse, color: C.bg }}
        >
          {busy === "샘플 데이터 생성" ? "처리 중…" : "샘플 데이터 생성"}
        </button>

        <button
          disabled={!!busy || (!demoReportCount && !demoAccountCount)}
          onClick={() => {
            if (window.confirm("샘플 데이터만 삭제할까요?"))
              run("샘플 데이터 삭제", onRemoveDemoData);
          }}
          className="w-full rounded py-3 text-sm font-bold disabled:opacity-40"
          style={{
            backgroundColor: "transparent",
            color: C.muted,
            border: `1px solid ${C.line}`,
          }}
        >
          샘플 데이터만 삭제
        </button>

        <button
          disabled={!!busy}
          onClick={() => {
            if (window.confirm("모든 기능 스위치를 기본값으로 돌릴까요?"))
              run("기능 설정 초기화", onResetFeatureFlags);
          }}
          className="w-full rounded py-3 text-sm font-bold disabled:opacity-40"
          style={{
            backgroundColor: "transparent",
            color: C.gold,
            border: `1px solid ${C.gold}`,
          }}
        >
          기능 설정 기본값으로 초기화
        </button>

        <div
          className="rounded p-3"
          style={{ border: `1px solid ${C.danger}66` }}
        >
          <p className="text-xs leading-relaxed" style={{ color: C.danger }}>
            아래 버튼은 제보, 계정, 평가, 사진, 기능 설정을 모두 삭제합니다.
            복구할 수 없습니다.
          </p>
          <button
            disabled={!!busy}
            onClick={() => {
              const answer = window.prompt(
                '전체 데이터를 삭제하려면 "초기화"를 입력하세요.',
              );
              if (answer === "초기화")
                run("전체 로컬 데이터 초기화", onResetAllLocalData);
            }}
            className="mt-3 w-full rounded py-3 text-sm font-bold disabled:opacity-40"
            style={{ backgroundColor: C.danger, color: "#fff" }}
          >
            전체 로컬 데이터 초기화
          </button>
        </div>

        {message && (
          <p className="text-center text-xs" style={{ color: C.abuse }}>
            {message}
          </p>
        )}
      </div>
    );
  }

  function AdminPanel({
    reports,
    accounts,
    featureFlags,
    onFeatureFlagChange,
    onDecide,
    onDelete,
    onToggleBan,
    onDeleteAccount,
    onResetVotes,
    onDecideVerify,
    onSeedDemoData,
    onRemoveDemoData,
    onResetFeatureFlags,
    onResetAllLocalData,
  }) {
    const [pass, setPass] = useState("");
    const [ok, setOk] = useState(false);
    const [sub, setSub] = useState("pending");
    const [q, setQ] = useState("");

    if (!ok) {
      return (
        <div className="px-4 py-10">
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setOk(pass === "admin")}
            className="w-full rounded px-3 py-2 text-sm outline-none"
            style={{
              backgroundColor: C.bg,
              border: `1px solid ${C.line}`,
              color: C.text,
            }}
            placeholder="관리자 비밀번호"
          />
          <button
            onClick={() => setOk(pass === "admin")}
            className="mt-3 w-full rounded py-3 text-sm font-bold"
            style={{
              backgroundColor: C.surfaceHi,
              color: C.text,
              border: `1px solid ${C.line}`,
            }}
          >
            들어가기
          </button>
          <p className="mt-4 text-xs" style={{ color: C.muted }}>
            프로토타입 비밀번호는 <span className="font-mono">admin</span>
            입니다.
          </p>
        </div>
      );
    }

    const pending = reports.filter((r) => r.status === "pending");
    const approved = reports.filter((r) => r.status === "approved");
    const rejected = reports.filter((r) => r.status === "rejected");
    const byCat = CAT_KEYS.reduce(
      (a, k) => ({
        ...a,
        [k]: approved.filter((r) => r.category === k).length,
      }),
      {},
    );
    const noEvidence = reports.filter((r) => !r.hasEvidence).length;
    const bannedCount = Object.values(accounts).filter((a) => a.banned).length;
    const verifyPendingCount = Object.values(accounts).filter(
      (a) => a.status === "pending",
    ).length;

    const groups = { pending, approved, rejected, all: reports };
    const shown =
      groups[sub === "users" || sub === "verify" ? "all" : sub]?.filter(
        (r) => !q.trim() || norm(r.nickname).includes(norm(q)),
      ) || [];

    const subTabs = [
      { id: "pending", label: `대기 ${pending.length}` },
      { id: "approved", label: `공개됨 ${approved.length}` },
      { id: "rejected", label: `반려됨 ${rejected.length}` },
      { id: "verify", label: `계정 인증 ${verifyPendingCount}` },
      { id: "users", label: `유저 ${Object.keys(accounts).length}` },
      { id: "features", label: "기능 설정" },
      { id: "debug", label: "테스트 도구" },
    ];

    return (
      <div className="px-4 py-5">
        <div className="grid grid-cols-3 gap-2">
          <div
            className="rounded p-3"
            style={{
              backgroundColor: C.surface,
              border: `1px solid ${C.line}`,
            }}
          >
            <div className="font-mono text-xl font-bold">{reports.length}</div>
            <div className="text-xs" style={{ color: C.muted }}>
              전체 제보
            </div>
          </div>
          <div
            className="rounded p-3"
            style={{
              backgroundColor: C.surface,
              border: `1px solid ${C.line}`,
            }}
          >
            <div
              className="font-mono text-xl font-bold"
              style={{ color: C.danger }}
            >
              {noEvidence}
            </div>
            <div className="text-xs" style={{ color: C.muted }}>
              증거 없는 제보
            </div>
          </div>
          <div
            className="rounded p-3"
            style={{
              backgroundColor: C.surface,
              border: `1px solid ${C.line}`,
            }}
          >
            <div
              className="font-mono text-xl font-bold"
              style={{ color: C.gold }}
            >
              {verifyPendingCount}
            </div>
            <div className="text-xs" style={{ color: C.muted }}>
              인증 대기 계정
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CAT_KEYS.map((k) => (
            <Chip key={k} color={CATS[k].color}>
              {CATS[k].label} {byCat[k]}
            </Chip>
          ))}
          <Chip color={C.danger}>정지 계정 {bannedCount}</Chip>
        </div>

        <div className="mt-4 flex gap-1.5 overflow-x-auto">
          {subTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              className="shrink-0 rounded px-3 py-1.5 text-xs font-semibold"
              style={{
                backgroundColor: sub === t.id ? C.gold : "transparent",
                color: sub === t.id ? C.bg : C.muted,
                border: `1px solid ${sub === t.id ? C.gold : C.line}`,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {!["users", "verify", "features", "debug"].includes(sub) && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="mt-3 w-full rounded px-3 py-2 font-mono text-sm outline-none"
            style={{
              backgroundColor: C.bg,
              border: `1px solid ${C.line}`,
              color: C.text,
            }}
            placeholder="닉네임으로 검색"
          />
        )}

        {sub === "debug" ? (
          <AdminDebugTools
            reports={reports}
            accounts={accounts}
            onSeedDemoData={onSeedDemoData}
            onRemoveDemoData={onRemoveDemoData}
            onResetFeatureFlags={onResetFeatureFlags}
            onResetAllLocalData={onResetAllLocalData}
          />
        ) : sub === "features" ? (
          <AdminFeatureFlags
            featureFlags={featureFlags}
            onChange={onFeatureFlagChange}
          />
        ) : sub === "users" ? (
          <AdminUsers
            accounts={accounts}
            onToggleBan={onToggleBan}
            onDeleteAccount={onDeleteAccount}
            onResetVotes={onResetVotes}
          />
        ) : sub === "verify" ? (
          <AdminVerify accounts={accounts} onDecide={onDecideVerify} />
        ) : shown.length === 0 ? (
          <p className="mt-8 text-center text-sm" style={{ color: C.muted }}>
            해당 항목이 없습니다.
          </p>
        ) : (
          shown.map((r) => (
            <AdminReportCard
              key={r.id}
              r={r}
              onDecide={onDecide}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    );
  }

  window.AdminReportCard = AdminReportCard;
  window.AdminVerify = AdminVerify;
  window.VerifyCard = VerifyCard;
  window.AdminUsers = AdminUsers;
  window.AdminFeatureFlags = AdminFeatureFlags;
  window.AdminDebugTools = AdminDebugTools;
  window.AdminPanel = AdminPanel;
})();
