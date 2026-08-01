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
  const { Chip, SpectrumBar, TrustBadge } = window;
  const { scanPII, fmtDate, compress, uid } = WR;
  function VoteButtons({
    reportId,
    votes,
    myVoted,
    session,
    canVote,
    votingEnabled,
    onVote,
    onNeedLogin,
  }) {
    const v = votes[reportId] || { up: 0, down: 0 };
    const already = myVoted.includes(reportId);
    const btn = (active, color) => ({
      backgroundColor: active ? `${color}22` : C.bg,
      border: `1px solid ${active ? color : C.line}`,
      color: active ? color : C.muted,
    });
    const handle = (dir) => {
      if (!session) return onNeedLogin();
      if (already || !canVote) return;
      onVote(reportId, dir);
    };

    return (
      <div className="mt-3 flex items-center gap-2">
        {!votingEnabled ? (
          <span className="text-xs" style={{ color: C.muted }}>
            평가 기능이 비활성화되었습니다.
          </span>
        ) : (
          <>
            <button
              disabled={already || !canVote}
              onClick={() => handle("up")}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold disabled:cursor-default"
              style={btn(already && v.up > 0, C.abuse)}
            >
              👍 신뢰함 <span className="font-mono">{v.up}</span>
            </button>
            <button
              disabled={already || !canVote}
              onClick={() => handle("down")}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold disabled:cursor-default"
              style={btn(already && v.down > 0, C.danger)}
            >
              👎 의심됨 <span className="font-mono">{v.down}</span>
            </button>
            {session && !canVote ? (
              <span className="text-xs" style={{ color: C.muted }}>
                계정 인증 후 평가 가능
              </span>
            ) : already ? (
              <span className="text-xs" style={{ color: C.muted }}>
                평가 완료
              </span>
            ) : !session ? (
              <span className="text-xs" style={{ color: C.muted }}>
                로그인 후 평가 가능
              </span>
            ) : null}
          </>
        )}
      </div>
    );
  }

  function Evidence({ reportId }) {
    const [shots, setShots] = useState(null);
    const [zoom, setZoom] = useState(null);

    useEffect(() => {
      let alive = true;
      (async () => {
        const res = await store.get(shotKey(reportId), true);
        if (alive) {
          try {
            setShots(res ? JSON.parse(res.value) : []);
          } catch {
            setShots([]);
          }
        }
      })();
      return () => {
        alive = false;
      };
    }, [reportId]);

    if (shots === null)
      return (
        <p className="mt-2 text-xs" style={{ color: C.muted }}>
          사진 불러오는 중…
        </p>
      );
    if (!shots.length)
      return (
        <p className="mt-2 text-xs" style={{ color: C.muted }}>
          첨부된 사진이 없습니다 (증거 없이 등록됨).
        </p>
      );

    return (
      <>
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {shots.map((src, i) => (
            <button key={i} onClick={() => setZoom(src)} className="shrink-0">
              <img
                src={src}
                alt={`증거 사진 ${i + 1}`}
                className="h-24 rounded object-cover"
                style={{ border: `1px solid ${C.line}` }}
              />
            </button>
          ))}
        </div>
        {zoom && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(0,0,0,0.88)" }}
            onClick={() => setZoom(null)}
          >
            <img
              src={zoom}
              alt="증거 사진 확대"
              className="max-h-full max-w-full rounded"
            />
          </div>
        )}
      </>
    );
  }

  function ReporterTag({ r }) {
    return r.reporterNickname ? (
      <Chip color={C.gold}>제보자: {r.reporterNickname}</Chip>
    ) : (
      <Chip>익명 제보</Chip>
    );
  }

  function PlayerRow({
    entry,
    expanded,
    onToggle,
    votes,
    myVoted,
    session,
    canVote,
    votingEnabled,
    onVote,
    onNeedLogin,
  }) {
    const top = CAT_KEYS.reduce(
      (a, b) => ((entry.counts[b] || 0) > (entry.counts[a] || 0) ? b : a),
      "hack",
    );

    return (
      <div
        style={{
          borderBottom: `1px solid ${C.line}`,
          opacity: entry.score < 0 ? 0.55 : 1,
        }}
      >
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          className="relative flex w-full items-center gap-3 px-4 py-3.5 text-left"
          style={{ backgroundColor: expanded ? C.surfaceHi : "transparent" }}
        >
          <div
            className="absolute left-0 top-0 h-full"
            style={{ width: 3, backgroundColor: CATS[top].color }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-base font-semibold">
                {entry.nickname}
              </span>
              <span
                className="ml-auto shrink-0 font-mono text-xs"
                style={{ color: C.muted }}
              >
                {entry.total}건
              </span>
            </div>
            <div className="mt-2">
              <SpectrumBar counts={entry.counts} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {CAT_KEYS.filter((k) => entry.counts[k]).map((k) => (
                <Chip key={k} color={CATS[k].color}>
                  {CATS[k].label} {entry.counts[k]}
                </Chip>
              ))}
              <TrustBadge score={entry.score} />
            </div>
          </div>
        </button>

        {expanded && (
          <div className="px-4 pb-4" style={{ backgroundColor: C.surfaceHi }}>
            {entry.score < 0 && (
              <p
                className="mt-3 rounded p-2 text-xs"
                style={{ backgroundColor: `${C.danger}18`, color: C.danger }}
              >
                이 유저에 대한 제보는 "의심됨" 평가가 더 많습니다. 개인적인
                악감정으로 올라온 제보일 수 있으니 참고해 주세요.
              </p>
            )}
            {entry.reports.map((r) => (
              <div
                key={r.id}
                className="mt-3 rounded p-3"
                style={{ backgroundColor: C.bg, border: `1px solid ${C.line}` }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Chip color={CATS[r.category].color} solid>
                    {CATS[r.category].label}
                  </Chip>
                  {r.tags.map((t) => (
                    <Chip key={t}>{t}</Chip>
                  ))}
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
                <p className="mt-2 text-sm leading-relaxed">{r.description}</p>
                <Evidence reportId={r.id} />
                <VoteButtons
                  reportId={r.id}
                  votes={votes}
                  myVoted={myVoted}
                  session={session}
                  canVote={canVote}
                  votingEnabled={votingEnabled}
                  onVote={onVote}
                  onNeedLogin={onNeedLogin}
                />
              </div>
            ))}
            <p
              className="mt-3 text-xs leading-relaxed"
              style={{ color: C.muted }}
            >
              제보자의 주장이며 사실로 확정된 내용이 아닙니다. 본인이라면 이의
              제기로 삭제를 요청할 수 있습니다.
            </p>
          </div>
        )}
      </div>
    );
  }

  function SubmitForm({ onSubmit, session, account, featureFlags }) {
    const [nickname, setNickname] = useState("");
    const [category, setCategory] = useState("hack");
    const [tags, setTags] = useState([]);
    const [mode, setMode] = useState(MODES[0]);
    const [occurredAt, setOccurredAt] = useState("");
    const [description, setDescription] = useState("");
    const [shots, setShots] = useState([]);
    const [reveal, setReveal] = useState(false);
    const [errors, setErrors] = useState([]);
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(false);
    const fileRef = useRef(null);

    const flags = useMemo(() => scanPII(description), [description]);
    const canReveal =
      featureFlags.reporterIdentity &&
      session &&
      account?.status === "approved" &&
      account?.gameNickname;

    const pickFiles = async (e) => {
      const chosen = e.target.files ? [...e.target.files] : [];
      e.target.value = "";
      if (!chosen.length) return;
      const files = chosen.slice(0, 3 - shots.length);
      setBusy(true);
      setErrors([]);
      const out = [];
      const failed = [];
      for (const f of files) {
        try {
          out.push(await compress(f));
        } catch (err) {
          failed.push(`${f.name || "사진"} (${err.message})`);
        }
      }
      if (out.length) setShots((p) => [...p, ...out]);
      if (failed.length) setErrors([`첨부 실패: ${failed.join(", ")}`]);
      setBusy(false);
    };

    const submit = async () => {
      const e = [];
      if (!NICK_RE.test(nickname)) e.push("닉네임은 2~20자로 입력해 주세요.");
      if (!occurredAt) e.push("발생 날짜를 입력해 주세요.");
      if (description.trim().length < 15)
        e.push("상황 설명을 15자 이상 적어 주세요.");
      if (featureFlags.evidenceRequired && !shots.length)
        e.push("증거 사진을 1장 이상 첨부해 주세요.");
      if (flags.length)
        e.push(
          `${flags.map((f) => f.label).join(", ")}가 포함되어 등록할 수 없습니다.`,
        );
      setErrors(e);
      if (e.length) return;

      setBusy(true);
      const id = uid();
      if (shots.length)
        await store.set(shotKey(id), JSON.stringify(shots), true);
      await onSubmit({
        id,
        nickname: nickname.trim(),
        category,
        tags,
        mode,
        occurredAt,
        description: description.trim(),
        hasEvidence: shots.length > 0,
        reporterNickname: canReveal && reveal ? account.gameNickname : null,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      setNickname("");
      setTags([]);
      setOccurredAt("");
      setDescription("");
      setShots([]);
      setReveal(false);
      setBusy(false);
      setDone(true);
      setTimeout(() => setDone(false), 4000);
    };

    const fieldStyle = {
      backgroundColor: C.bg,
      border: `1px solid ${C.line}`,
      color: C.text,
    };
    const field = "w-full rounded px-3 py-2 text-sm outline-none";
    const label = "mt-5 block font-mono text-xs tracking-widest";

    return (
      <div className="px-4 py-5">
        <p
          className="rounded p-3 text-xs leading-relaxed"
          style={{
            backgroundColor: `${C.gold}12`,
            border: `1px solid ${C.gold}44`,
          }}
        >
          <strong style={{ color: C.gold }}>게임 닉네임만 적어 주세요.</strong>{" "}
          실명·연락처·학교·SNS가 들어간 제보는 자동으로 막힙니다. 모든 제보는
          운영자 승인 후에만 공개됩니다.
        </p>
        <p
          className="mt-2 rounded p-2 text-xs leading-relaxed"
          style={{ backgroundColor: `${C.hack}18`, color: C.hack }}
        >
          증거 사진:{" "}
          {featureFlags.evidenceUpload
            ? featureFlags.evidenceRequired
              ? "필수"
              : "선택"
            : "첨부 기능 비활성화"}
        </p>

        <label className={label} style={{ color: C.muted }}>
          게임 닉네임 (신고 대상)
        </label>
        <input
          className={`${field} mt-2 font-mono`}
          style={fieldStyle}
          value={nickname}
          maxLength={20}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="예: 협곡의파괴자"
        />

        {canReveal ? (
          <div
            className="mt-5 rounded p-3"
            style={{ backgroundColor: C.bg, border: `1px solid ${C.line}` }}
          >
            <p
              className="font-mono text-xs tracking-widest"
              style={{ color: C.muted }}
            >
              내 게임 아이디 공개 여부
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => setReveal(false)}
                className="rounded py-2 text-xs font-semibold"
                style={{
                  backgroundColor: !reveal ? C.gold : "transparent",
                  color: !reveal ? C.bg : C.muted,
                  border: `1px solid ${!reveal ? C.gold : C.line}`,
                }}
              >
                비공개 (익명)
              </button>
              <button
                onClick={() => setReveal(true)}
                className="rounded py-2 text-xs font-semibold"
                style={{
                  backgroundColor: reveal ? C.gold : "transparent",
                  color: reveal ? C.bg : C.muted,
                  border: `1px solid ${reveal ? C.gold : C.line}`,
                }}
              >
                공개 ({account.gameNickname})
              </button>
            </div>
            <p className="mt-2 text-xs" style={{ color: C.muted }}>
              공개하면 이 제보에 내 인증된 게임 닉네임이 함께 표시됩니다. 확신이
              없다면 비공개를 권장합니다.
            </p>
          </div>
        ) : (
          <p
            className="mt-3 text-xs leading-relaxed"
            style={{ color: C.muted }}
          >
            게임 계정 인증을 마치면 원할 때 자신의 게임 아이디를 제보에 공개할
            수 있습니다. 지금은 익명으로 등록됩니다.
          </p>
        )}

        <label className={label} style={{ color: C.muted }}>
          분류
        </label>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {CAT_KEYS.map((k) => (
            <button
              key={k}
              onClick={() => {
                setCategory(k);
                setTags([]);
              }}
              className="rounded py-3 text-sm font-semibold"
              style={{
                backgroundColor: category === k ? CATS[k].color : C.bg,
                color: category === k ? C.bg : C.muted,
                border: `1px solid ${category === k ? CATS[k].color : C.line}`,
              }}
            >
              {CATS[k].label}
            </button>
          ))}
        </div>

        {CATS[category].tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {CATS[category].tags.map((t) => (
              <button
                key={t}
                onClick={() =>
                  setTags((p) =>
                    p.includes(t) ? p.filter((x) => x !== t) : [...p, t],
                  )
                }
                className="rounded px-3 py-1.5 text-xs"
                style={{
                  backgroundColor: tags.includes(t)
                    ? `${CATS[category].color}30`
                    : C.bg,
                  border: `1px solid ${tags.includes(t) ? CATS[category].color : C.line}`,
                  color: tags.includes(t) ? CATS[category].color : C.muted,
                }}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div>
            <label
              className="block font-mono text-xs tracking-widest"
              style={{ color: C.muted }}
            >
              발생 날짜
            </label>
            <input
              type="date"
              className={`${field} mt-2`}
              style={fieldStyle}
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </div>
          <div>
            <label
              className="block font-mono text-xs tracking-widest"
              style={{ color: C.muted }}
            >
              모드
            </label>
            <select
              className={`${field} mt-2`}
              style={fieldStyle}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className={label} style={{ color: C.muted }}>
          상황 설명
        </label>
        <textarea
          rows={3}
          className={`${field} mt-2 resize-none`}
          style={fieldStyle}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="어떤 상황에서 무엇을 봤는지 사실만 적어 주세요."
        />
        {flags.length > 0 && (
          <p className="mt-2 text-xs" style={{ color: C.danger }}>
            차단 대상: {flags.map((f) => f.label).join(", ")} — 지워야
            등록됩니다.
          </p>
        )}

        {featureFlags.evidenceUpload && (
          <>
            <label className={label} style={{ color: C.muted }}>
              증거 사진 · {featureFlags.evidenceRequired ? "필수" : "선택"} ·
              최대 3장
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {shots.map((s, i) => (
                <div key={i} className="relative">
                  <img
                    src={s}
                    alt={`첨부 ${i + 1}`}
                    className="h-20 w-20 rounded object-cover"
                    style={{ border: `1px solid ${C.line}` }}
                  />
                  <button
                    onClick={() => setShots((p) => p.filter((_, j) => j !== i))}
                    className="absolute right-1 top-1 h-5 w-5 rounded-full text-xs font-bold"
                    style={{ backgroundColor: C.danger, color: "#fff" }}
                    aria-label="사진 삭제"
                  >
                    ×
                  </button>
                </div>
              ))}
              {shots.length < 3 && (
                <div className="relative h-20 w-20">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={pickFiles}
                    disabled={busy}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                  <div
                    className="pointer-events-none flex h-full w-full items-center justify-center rounded text-2xl"
                    style={{ border: `1px dashed ${C.line}`, color: C.muted }}
                  >
                    {busy ? "…" : "+"}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => fileRef.current && fileRef.current.click()}
              className="mt-2 rounded px-3 py-1.5 text-xs"
              style={{ border: `1px solid ${C.line}`, color: C.muted }}
            >
              선택창이 안 열리면 여기를 눌러 주세요
            </button>
          </>
        )}

        {errors.length > 0 && (
          <ul
            className="mt-4 rounded p-3 text-xs"
            style={{
              backgroundColor: `${C.danger}14`,
              border: `1px solid ${C.danger}55`,
              color: C.danger,
            }}
          >
            {errors.map((e, i) => (
              <li key={i} className="mt-1 first:mt-0">
                · {e}
              </li>
            ))}
          </ul>
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
          {busy ? "처리 중…" : "검수 요청 보내기"}
        </button>
        {done && (
          <p className="mt-3 text-center text-sm" style={{ color: C.abuse }}>
            검수 대기열에 등록했습니다. 승인 전까지는 공개되지 않습니다.
          </p>
        )}
      </div>
    );
  }

  window.VoteButtons = VoteButtons;
  window.Evidence = Evidence;
  window.ReporterTag = ReporterTag;
  window.PlayerRow = PlayerRow;
  window.SubmitForm = SubmitForm;
})();
