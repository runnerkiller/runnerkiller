(function () {
  const { useState, useEffect, useMemo, useRef } = React;
  const {
    C,
    CATS,
    CAT_KEYS,
    REPORTS_KEY,
    VOTES_KEY,
    ACCOUNTS_KEY,
    SESSION_KEY,
    FEATURE_FLAGS_KEY,
    DEFAULT_FEATURE_FLAGS,
  } = WR;
  const { store, shotKey, verifyKey } = WR;
  const { uid, norm, hashPass } = WR;
  function App() {
    const [reports, setReports] = useState([]);
    const [votes, setVotes] = useState({});
    const [accounts, setAccounts] = useState({});
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [memoryOnly, setMemoryOnly] = useState(false);
    const [tab, setTab] = useState("list");
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [open, setOpen] = useState(null);
    const [featureFlags, setFeatureFlags] = useState({
      ...DEFAULT_FEATURE_FLAGS,
    });

    useEffect(() => {
      (async () => {
        const ok = await store.probe();
        setMemoryOnly(!ok);
        const read = async (key, shared, fallback) => {
          const res = await store.get(key, shared);
          try {
            return res ? JSON.parse(res.value) : fallback;
          } catch {
            return fallback;
          }
        };
        setReports(await read(REPORTS_KEY, true, []));
        setVotes(await read(VOTES_KEY, true, {}));
        setAccounts(await read(ACCOUNTS_KEY, true, {}));
        setSession(await read(SESSION_KEY, false, null));
        setFeatureFlags({
          ...DEFAULT_FEATURE_FLAGS,
          ...(await read(FEATURE_FLAGS_KEY, true, {})),
        });
        setLoading(false);
      })();
    }, []);

    const persistReports = async (next) => {
      setReports(next);
      await store.set(REPORTS_KEY, JSON.stringify(next), true);
    };
    const persistAccounts = async (next) => {
      setAccounts(next);
      await store.set(ACCOUNTS_KEY, JSON.stringify(next), true);
    };
    const changeFeatureFlag = async (key, value) => {
      const next = { ...featureFlags, [key]: value };
      if (key === "evidenceUpload" && !value) next.evidenceRequired = false;
      setFeatureFlags(next);
      await store.set(FEATURE_FLAGS_KEY, JSON.stringify(next), true);
      if (
        (key === "reportSubmission" && !value && tab === "submit") ||
        (key === "authentication" && !value && tab === "login")
      )
        setTab("list");
    };

    const addReport = (r) => persistReports([r, ...reports]);
    const decide = async (id, status) =>
      persistReports(reports.map((r) => (r.id === id ? { ...r, status } : r)));
    const deleteReport = async (id) => {
      await store.del(shotKey(id), true);
      persistReports(reports.filter((r) => r.id !== id));
    };

    const toggleBan = (id) =>
      persistAccounts({
        ...accounts,
        [id]: { ...accounts[id], banned: !accounts[id].banned },
      });
    const resetVotes = (id) =>
      persistAccounts({ ...accounts, [id]: { ...accounts[id], voted: [] } });
    const deleteAccount = async (id) => {
      await store.del(verifyKey(id), true);
      const next = { ...accounts };
      delete next[id];
      persistAccounts(next);
    };
    const decideVerify = (id, status) =>
      persistAccounts({ ...accounts, [id]: { ...accounts[id], status } });

    const login = async (userId, pass, mode, gameNickname, verifyShot) => {
      if (!featureFlags.authentication)
        throw new Error("로그인 기능이 비활성화되어 있습니다.");
      if (mode === "signup" && !featureFlags.signup)
        throw new Error("현재 회원가입을 받지 않습니다.");
      const hash = await hashPass(pass);
      const res = await store.get(ACCOUNTS_KEY, true);
      let latest = accounts;
      try {
        latest = res ? JSON.parse(res.value) : {};
      } catch {
        latest = {};
      }

      const existing = latest[userId];
      let next = latest;
      if (mode === "signup") {
        if (existing) throw new Error("이미 사용 중인 아이디입니다.");
        next = {
          ...latest,
          [userId]: {
            passHash: hash,
            gameNickname,
            status: "pending",
            banned: false,
            voted: [],
          },
        };
        await store.set(ACCOUNTS_KEY, JSON.stringify(next), true);
        await store.set(verifyKey(userId), verifyShot, true);
      } else {
        if (!existing)
          throw new Error(
            "존재하지 않는 아이디입니다. 회원가입 탭에서 계정을 먼저 만들어 주세요.",
          );
        if (existing.passHash !== hash)
          throw new Error("비밀번호가 일치하지 않습니다.");
        if (existing.banned)
          throw new Error("정지된 계정입니다. 운영자에게 문의해 주세요.");
        if (existing.status === "rejected")
          throw new Error(
            "게임 계정 인증이 거절되었습니다. 새 아이디로 다시 가입해 주세요.",
          );
      }
      setAccounts(next);
      setSession(userId);
      await store.set(SESSION_KEY, JSON.stringify(userId), false);
      setTab("list");
    };

    const logout = async () => {
      setSession(null);
      await store.del(SESSION_KEY, false);
    };

    const vote = async (reportId, dir) => {
      if (!featureFlags.authentication || !featureFlags.voting || !session)
        return;
      const acc = accounts[session] || {
        passHash: "",
        voted: [],
        banned: false,
        status: "pending",
      };
      if (
        acc.banned ||
        acc.status !== "approved" ||
        acc.voted.includes(reportId)
      )
        return;
      const cur = votes[reportId] || { up: 0, down: 0 };
      const nextVotes = {
        ...votes,
        [reportId]: { ...cur, [dir]: cur[dir] + 1 },
      };
      const nextAccounts = {
        ...accounts,
        [session]: { ...acc, voted: [...acc.voted, reportId] },
      };
      setVotes(nextVotes);
      setAccounts(nextAccounts);
      await store.set(VOTES_KEY, JSON.stringify(nextVotes), true);
      await store.set(ACCOUNTS_KEY, JSON.stringify(nextAccounts), true);
    };

    const myAccount = session ? accounts[session] : null;
    const myVoted = myAccount?.voted || [];
    const canVote =
      featureFlags.authentication &&
      featureFlags.voting &&
      !!myAccount &&
      myAccount.status === "approved" &&
      !myAccount.banned;
    const approved = reports.filter((r) => r.status === "approved");
    const pendingCount = reports.filter((r) => r.status === "pending").length;
    const catCounts = CAT_KEYS.reduce(
      (a, k) => ({
        ...a,
        [k]: approved.filter((r) => r.category === k).length,
      }),
      {},
    );

    const entries = useMemo(() => {
      const map = new Map();
      approved.forEach((r) => {
        const key = norm(r.nickname);
        if (!map.has(key))
          map.set(key, {
            nickname: r.nickname,
            counts: {},
            reports: [],
            total: 0,
            score: 0,
          });
        const e = map.get(key);
        e.counts[r.category] = (e.counts[r.category] || 0) + 1;
        e.reports.push(r);
        e.total += 1;
        const v = votes[r.id] || { up: 0, down: 0 };
        e.score += v.up - v.down;
      });
      let list = [...map.values()];
      if (filter !== "all") list = list.filter((e) => e.counts[filter]);
      if (query.trim())
        list = list.filter((e) => norm(e.nickname).includes(norm(query)));
      return list.sort((a, b) => b.score - a.score || b.total - a.total);
    }, [approved, filter, query, votes]);

    const tabs = [
      { id: "list", label: "명단" },
      ...(featureFlags.reportSubmission
        ? [{ id: "submit", label: "제보하기" }]
        : []),
      { id: "admin", label: `관리자${pendingCount ? ` ${pendingCount}` : ""}` },
    ];

    return (
      <div
        className="min-h-screen font-sans"
        style={{ backgroundColor: C.bg, color: C.text }}
      >
        <style>{`
        *:focus-visible { outline: 2px solid ${C.gold}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      `}</style>

        <div className="mx-auto max-w-2xl">
          <header className="px-4 pb-3 pt-6">
            <h1 className="text-xl font-bold tracking-tight">
              협곡 <span style={{ color: C.gold }}>기록소</span>
            </h1>
            <p className="mt-1 text-xs" style={{ color: C.muted }}>
              와일드 리프트 비정상 플레이 제보 · 승인 후 공개 · 커뮤니티 신뢰도
              평가
            </p>
          </header>

          {memoryOnly && (
            <p
              className="mx-4 rounded p-2 text-xs"
              style={{ backgroundColor: `${C.gold}18`, color: C.gold }}
            >
              저장소를 쓸 수 없어 이번 세션에서만 데이터가 유지됩니다.
              새로고침하면 사라집니다.
            </p>
          )}

          {session && featureFlags.authentication && (
            <AuthBar session={session} account={myAccount} onLogout={logout} />
          )}

          <nav className="flex" style={{ borderBottom: `1px solid ${C.line}` }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex-1 py-3 text-sm font-semibold"
                style={{
                  color: tab === t.id ? C.gold : C.muted,
                  borderBottom: `2px solid ${tab === t.id ? C.gold : "transparent"}`,
                }}
              >
                {t.label}
              </button>
            ))}
            {!session && featureFlags.authentication && (
              <button
                onClick={() => setTab("login")}
                className="flex-1 py-3 text-sm font-semibold"
                style={{
                  color: tab === "login" ? C.gold : C.muted,
                  borderBottom: `2px solid ${tab === "login" ? C.gold : "transparent"}`,
                }}
              >
                로그인
              </button>
            )}
          </nav>

          {loading ? (
            <p
              className="px-4 py-16 text-center text-sm"
              style={{ color: C.muted }}
            >
              불러오는 중…
            </p>
          ) : tab === "list" && !featureFlags.publicList ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm">
                공개 명단 기능이 잠시 비활성화되었습니다.
              </p>
              <p className="mt-2 text-xs" style={{ color: C.muted }}>
                관리자가 디버깅 중입니다.
              </p>
            </div>
          ) : tab === "list" ? (
            <>
              <div className="px-4 py-4">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full rounded px-3 py-2 font-mono text-sm outline-none"
                  style={{
                    backgroundColor: C.surface,
                    border: `1px solid ${C.line}`,
                    color: C.text,
                  }}
                  placeholder="닉네임 검색"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => setFilter("all")}
                    className="rounded px-3 py-1.5 text-xs font-semibold"
                    style={{
                      backgroundColor:
                        filter === "all" ? C.gold : "transparent",
                      color: filter === "all" ? C.bg : C.muted,
                      border: `1px solid ${filter === "all" ? C.gold : C.line}`,
                    }}
                  >
                    전체 {approved.length}
                  </button>
                  {CAT_KEYS.map((k) => (
                    <button
                      key={k}
                      onClick={() => setFilter(filter === k ? "all" : k)}
                      className="rounded px-3 py-1.5 text-xs font-semibold"
                      style={{
                        backgroundColor:
                          filter === k ? CATS[k].color : "transparent",
                        color: filter === k ? C.bg : CATS[k].color,
                        border: `1px solid ${filter === k ? CATS[k].color : `${CATS[k].color}55`}`,
                      }}
                    >
                      {CATS[k].label} {catCounts[k]}
                    </button>
                  ))}
                </div>
                <p
                  className="mt-3 text-xs leading-relaxed"
                  style={{ color: C.muted }}
                >
                  "신뢰함"이 많을수록 위로, "의심됨"이 많은 제보는 흐리게
                  표시되며 아래로 내려갑니다.
                </p>
              </div>

              {entries.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <p className="text-sm">아직 공개된 제보가 없습니다.</p>
                  {featureFlags.reportSubmission && (
                    <button
                      onClick={() => setTab("submit")}
                      className="mt-5 rounded px-5 py-2.5 text-sm font-bold"
                      style={{ backgroundColor: C.gold, color: C.bg }}
                    >
                      첫 제보 남기기
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ borderTop: `1px solid ${C.line}` }}>
                  {entries.map((e) => (
                    <PlayerRow
                      key={e.nickname}
                      entry={e}
                      expanded={open === e.nickname}
                      onToggle={() =>
                        setOpen(open === e.nickname ? null : e.nickname)
                      }
                      votes={votes}
                      myVoted={myVoted}
                      session={session}
                      canVote={canVote}
                      onVote={vote}
                      votingEnabled={featureFlags.voting}
                      onNeedLogin={() =>
                        featureFlags.authentication && setTab("login")
                      }
                    />
                  ))}
                </div>
              )}
            </>
          ) : tab === "submit" ? (
            <SubmitForm
              onSubmit={addReport}
              session={session}
              account={myAccount}
              featureFlags={featureFlags}
            />
          ) : tab === "login" ? (
            <LoginForm onLogin={login} allowSignup={featureFlags.signup} />
          ) : (
            <AdminPanel
              reports={reports}
              accounts={accounts}
              featureFlags={featureFlags}
              onFeatureFlagChange={changeFeatureFlag}
              onDecide={decide}
              onDelete={deleteReport}
              onToggleBan={toggleBan}
              onDeleteAccount={deleteAccount}
              onResetVotes={resetVotes}
              onDecideVerify={decideVerify}
            />
          )}

          <footer
            className="px-4 py-8"
            style={{ borderTop: `1px solid ${C.line}` }}
          >
            <p className="text-xs leading-relaxed" style={{ color: C.muted }}>
              제보 내용은 제보자의 주장이며 사실로 확정된 것이 아닙니다. 신뢰도
              점수는 커뮤니티 평가를 반영할 뿐 공식 판정이 아닙니다. 게임 닉네임
              외의 신상 정보 게시는 금지되며, 본인이 요청하면 즉시 비공개
              처리합니다. 라이엇 게임즈 고객지원을 통한 공식 신고도 함께 진행해
              주세요.
            </p>
          </footer>
        </div>
      </div>
    );
  }

  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(<App />);
})();
