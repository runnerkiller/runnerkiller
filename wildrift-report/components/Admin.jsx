const { useState, useEffect, useMemo, useRef } = React;
const { C, CATS, CAT_KEYS, MODES, NICK_RE, ID_RE, ACC_COLOR, ACC_LABEL, STATUS_LABEL, STATUS_COLOR } = WR;
const { store, shotKey, verifyKey } = WR;
const { Chip, Evidence, ReporterTag } = window;
const { scanPII, fmtDate, fmtDateTime, compress, hashPass } = WR;
function AdminReportCard({ r, onDecide, onDelete }) {
  const flags = scanPII(r.description);
  return (
    <div className="mt-4 rounded p-4" style={{ backgroundColor: C.surface, border: `1px solid ${C.line}` }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{r.nickname}</span>
        <Chip color={CATS[r.category].color} solid>{CATS[r.category].label}</Chip>
        {r.tags.map((t) => <Chip key={t}>{t}</Chip>)}
        <Chip color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Chip>
        {!r.hasEvidence && <Chip color={C.danger}>증거 없음</Chip>}
        <span className="ml-auto font-mono text-xs" style={{ color: C.muted }}>
          {fmtDate(r.occurredAt)} · {r.mode}
        </span>
      </div>
      <div className="mt-2"><ReporterTag r={r} /></div>
      <p className="mt-3 text-sm leading-relaxed">{r.description}</p>
      <Evidence reportId={r.id} />
      {flags.length > 0 && (
        <p className="mt-3 rounded p-2 text-xs" style={{ backgroundColor: `${C.danger}18`, color: C.danger }}>
          신상 정보 의심: {flags.map((f) => f.label).join(", ")}
        </p>
      )}
      <p className="mt-2 font-mono text-xs" style={{ color: C.muted }}>등록: {fmtDateTime(r.createdAt)}</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <button onClick={() => onDecide(r.id, "approved")} disabled={r.status === "approved"}
          className="rounded py-2.5 text-xs font-bold disabled:opacity-40"
          style={{ backgroundColor: C.abuse, color: C.bg }}>공개 승인</button>
        <button onClick={() => onDecide(r.id, "rejected")} disabled={r.status === "rejected"}
          className="rounded py-2.5 text-xs font-bold disabled:opacity-40"
          style={{ backgroundColor: "transparent", color: C.danger, border: `1px solid ${C.danger}` }}>반려</button>
        <button onClick={() => onDelete(r.id)}
          className="rounded py-2.5 text-xs font-bold"
          style={{ backgroundColor: "transparent", color: C.muted, border: `1px solid ${C.line}` }}>영구 삭제</button>
      </div>
    </div>
  );
}

/* ============================ 관리자: 계정 인증 대기 ============================ */
function AdminVerify({ accounts, onDecide }) {
  const pending = Object.entries(accounts).filter(([, a]) => a.status === "pending");
  if (!pending.length) return <p className="mt-8 text-center text-sm" style={{ color: C.muted }}>인증 대기 중인 계정이 없습니다.</p>;

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
    return () => { alive = false; };
  }, [userId]);

  return (
    <div className="rounded p-3" style={{ backgroundColor: C.surface, border: `1px solid ${C.line}` }}>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-semibold">{userId}</span>
        <span className="text-xs" style={{ color: C.muted }}>게임 닉네임:</span>
        <span className="font-mono text-sm" style={{ color: C.gold }}>{acc.gameNickname}</span>
      </div>
      {shot ? (
        <img src={shot} alt="인증 스크린샷" className="mt-3 max-h-64 rounded object-contain"
          style={{ border: `1px solid ${C.line}` }} />
      ) : (
        <p className="mt-3 text-xs" style={{ color: C.muted }}>스크린샷 불러오는 중…</p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => onDecide(userId, "approved")} className="rounded py-2.5 text-xs font-bold"
          style={{ backgroundColor: C.abuse, color: C.bg }}>인증 승인</button>
        <button onClick={() => onDecide(userId, "rejected")} className="rounded py-2.5 text-xs font-bold"
          style={{ backgroundColor: "transparent", color: C.danger, border: `1px solid ${C.danger}` }}>인증 거절</button>
      </div>
    </div>
  );
}

function AdminUsers({ accounts, onToggleBan, onDeleteAccount, onResetVotes }) {
  const list = Object.entries(accounts).sort((a, b) => (b[1].voted?.length || 0) - (a[1].voted?.length || 0));
  if (!list.length) return <p className="mt-6 text-center text-sm" style={{ color: C.muted }}>가입된 계정이 없습니다.</p>;

  return (
    <div className="mt-4 space-y-2">
      {list.map(([id, acc]) => (
        <div key={id} className="rounded p-3" style={{ backgroundColor: C.surface, border: `1px solid ${C.line}` }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{id}</span>
            <Chip color={ACC_COLOR[acc.status]}>{ACC_LABEL[acc.status]}</Chip>
            {acc.gameNickname && <span className="font-mono text-xs" style={{ color: C.muted }}>({acc.gameNickname})</span>}
            {acc.banned && <Chip color={C.danger} solid>정지됨</Chip>}
            <span className="ml-auto font-mono text-xs" style={{ color: C.muted }}>평가 {acc.voted?.length || 0}건</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button onClick={() => onToggleBan(id)} className="rounded py-2 text-xs font-bold"
              style={{
                backgroundColor: acc.banned ? C.abuse : "transparent",
                color: acc.banned ? C.bg : C.danger,
                border: `1px solid ${acc.banned ? C.abuse : C.danger}`,
              }}>
              {acc.banned ? "정지 해제" : "계정 정지"}
            </button>
            <button onClick={() => onResetVotes(id)} className="rounded py-2 text-xs font-bold"
              style={{ backgroundColor: "transparent", color: C.muted, border: `1px solid ${C.line}` }}>
              평가 기록 초기화
            </button>
            <button onClick={() => onDeleteAccount(id)} className="rounded py-2 text-xs font-bold"
              style={{ backgroundColor: "transparent", color: C.muted, border: `1px solid ${C.line}` }}>
              계정 삭제
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AdminPanel({ reports, accounts, onDecide, onDelete, onToggleBan, onDeleteAccount, onResetVotes, onDecideVerify }) {
  const [pass, setPass] = useState("");
  const [ok, setOk] = useState(false);
  const [sub, setSub] = useState("pending");
  const [q, setQ] = useState("");

  if (!ok) {
    return (
      <div className="px-4 py-10">
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setOk(pass === "admin")}
          className="w-full rounded px-3 py-2 text-sm outline-none"
          style={{ backgroundColor: C.bg, border: `1px solid ${C.line}`, color: C.text }}
          placeholder="관리자 비밀번호" />
        <button onClick={() => setOk(pass === "admin")} className="mt-3 w-full rounded py-3 text-sm font-bold"
          style={{ backgroundColor: C.surfaceHi, color: C.text, border: `1px solid ${C.line}` }}>
          들어가기
        </button>
        <p className="mt-4 text-xs" style={{ color: C.muted }}>
          프로토타입 비밀번호는 <span className="font-mono">admin</span>입니다.
        </p>
      </div>
    );
  }

  const pending = reports.filter((r) => r.status === "pending");
  const approved = reports.filter((r) => r.status === "approved");
  const rejected = reports.filter((r) => r.status === "rejected");
  const byCat = CAT_KEYS.reduce((a, k) => ({ ...a, [k]: approved.filter((r) => r.category === k).length }), {});
  const noEvidence = reports.filter((r) => !r.hasEvidence).length;
  const bannedCount = Object.values(accounts).filter((a) => a.banned).length;
  const verifyPendingCount = Object.values(accounts).filter((a) => a.status === "pending").length;

  const groups = { pending, approved, rejected, all: reports };
  const shown = groups[sub === "users" || sub === "verify" ? "all" : sub]?.filter((r) => !q.trim() || norm(r.nickname).includes(norm(q))) || [];

  const subTabs = [
    { id: "pending", label: `대기 ${pending.leng