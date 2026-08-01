(function () {
  const { useEffect, useMemo, useState } = React;
  const { C, CATS, CAT_KEYS, DEFAULT_FEATURE_FLAGS } = WR;
  const { norm } = WR;
  const { Chip, PlayerRow, SubmitForm, SinglePhotoPicker } = window;

  const mapReport = (report) => ({
    ...report,
    id: report.reportId,
    hasEvidence: (report.evidenceCount || report.evidence?.length || 0) > 0,
  });

  function Notice({ children, danger = false }) {
    return (
      <p
        className="mx-4 mt-3 rounded p-3 text-xs leading-relaxed"
        style={{
          color: danger ? C.danger : C.gold,
          backgroundColor: `${danger ? C.danger : C.gold}14`,
          border: `1px solid ${danger ? C.danger : C.gold}44`,
        }}
      >
        {children}
      </p>
    );
  }

  function DiscordLogin({ api }) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm font-semibold">Discord 계정으로 로그인합니다.</p>
        <p className="mt-2 text-xs leading-relaxed" style={{ color: C.muted }}>
          사이트는 Discord 비밀번호를 받지 않습니다. 로그인 후 게임 프로필
          스크린샷을 제출하면 운영자가 인증합니다.
        </p>
        <button
          onClick={() => api.login()}
          className="mt-6 w-full rounded py-3 text-sm font-bold"
          style={{ backgroundColor: C.hack, color: "#fff" }}
        >
          Discord로 계속하기
        </button>
      </div>
    );
  }

  function VerificationForm({ api, account, onComplete }) {
    const [gameNickname, setGameNickname] = useState("");
    const [evidence, setEvidence] = useState(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const status = account?.verificationStatus || "unverified";

    if (status === "pending") {
      return <Notice>게임 계정 인증 승인 대기 중입니다.</Notice>;
    }
    if (status === "approved") {
      return <Notice>게임 계정 인증이 완료되었습니다.</Notice>;
    }

    const submit = async () => {
      if (!gameNickname.trim() || !evidence) {
        setMessage("게임 닉네임과 프로필 스크린샷을 모두 입력해 주세요.");
        return;
      }
      setBusy(true);
      setMessage("");
      try {
        await api.request("/api/verifications", {
          method: "POST",
          body: { gameNickname: gameNickname.trim(), evidence },
        });
        setMessage(
          "인증 요청을 보냈습니다. 운영자 승인 후 평가할 수 있습니다.",
        );
        await onComplete();
      } catch (error) {
        setMessage(error.message);
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="px-4 py-6">
        <h2 className="text-sm font-bold">게임 계정 인증</h2>
        <input
          value={gameNickname}
          onChange={(event) => setGameNickname(event.target.value)}
          maxLength={20}
          placeholder="와일드 리프트 게임 닉네임"
          className="mt-4 w-full rounded px-3 py-2 text-sm outline-none"
          style={{ backgroundColor: C.bg, border: `1px solid ${C.line}` }}
        />
        <div className="mt-4">
          <SinglePhotoPicker
            value={evidence}
            onChange={setEvidence}
            label="닉네임이 보이는 게임 프로필 화면"
          />
        </div>
        {message && (
          <p className="mt-3 text-xs" style={{ color: C.gold }}>
            {message}
          </p>
        )}
        <button
          onClick={submit}
          disabled={busy}
          className="mt-5 w-full rounded py-3 text-sm font-bold disabled:opacity-50"
          style={{ backgroundColor: C.gold, color: C.bg }}
        >
          {busy ? "처리 중…" : "인증 요청 보내기"}
        </button>
      </div>
    );
  }

  function DiscordAdmin({ api, featureFlags, onFlagsChanged, onRefresh }) {
    const [sub, setSub] = useState("reports");
    const [reports, setReports] = useState([]);
    const [verifications, setVerifications] = useState([]);
    const [users, setUsers] = useState([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");

    const load = async () => {
      setBusy(true);
      setMessage("");
      try {
        const [reportData, verificationData, userData] = await Promise.all([
          api.request("/api/admin/reports?status=pending"),
          api.request("/api/admin/verifications?status=pending"),
          api.request("/api/admin/users"),
        ]);
        setReports(reportData.reports.map(mapReport));
        setVerifications(verificationData.verifications || []);
        setUsers(userData.users || []);
      } catch (error) {
        setMessage(error.message);
      } finally {
        setBusy(false);
      }
    };

    useEffect(() => {
      load();
    }, []);

    const decideReport = async (id, status) => {
      setBusy(true);
      try {
        await api.request(`/api/admin/reports/${id}/status`, {
          method: "PATCH",
          body: { status },
        });
        await Promise.all([load(), onRefresh()]);
      } catch (error) {
        setMessage(error.message);
        setBusy(false);
      }
    };

    const decideVerification = async (id, status) => {
      setBusy(true);
      try {
        await api.request(`/api/admin/verifications/${id}/status`, {
          method: "PATCH",
          body: { status },
        });
        await load();
      } catch (error) {
        setMessage(error.message);
        setBusy(false);
      }
    };

    const toggleBan = async (user) => {
      setBusy(true);
      try {
        await api.request(`/api/admin/users/${user.discordUserId}/ban`, {
          method: "PATCH",
          body: { banned: !user.banned },
        });
        await load();
      } catch (error) {
        setMessage(error.message);
        setBusy(false);
      }
    };

    const changeFlag = async (key, value) => {
      setBusy(true);
      try {
        const result = await api.request("/api/admin/config", {
          method: "PATCH",
          body: { [key]: value },
        });
        onFlagsChanged(result.config);
      } catch (error) {
        setMessage(error.message);
      } finally {
        setBusy(false);
      }
    };

    const tabs = [
      ["reports", `제보 ${reports.length}`],
      ["verify", `인증 ${verifications.length}`],
      ["users", `유저 ${users.length}`],
      ["features", "기능 설정"],
    ];
    return (
      <div className="px-4 py-5">
        <div className="flex gap-2 overflow-x-auto">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSub(id)}
              className="shrink-0 rounded px-3 py-2 text-xs font-bold"
              style={{
                backgroundColor: sub === id ? C.gold : "transparent",
                color: sub === id ? C.bg : C.muted,
                border: `1px solid ${sub === id ? C.gold : C.line}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {message && <Notice danger>{message}</Notice>}
        {busy && (
          <p className="mt-4 text-xs" style={{ color: C.muted }}>
            처리 중…
          </p>
        )}
        {sub === "reports" &&
          reports.map((report) => (
            <div
              key={report.id}
              className="mt-3 rounded p-3"
              style={{
                backgroundColor: C.surface,
                border: `1px solid ${C.line}`,
              }}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold">
                  {report.nickname}
                </span>
                <Chip color={CATS[report.category].color}>
                  {CATS[report.category].label}
                </Chip>
              </div>
              <p className="mt-2 text-sm">{report.description}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => decideReport(report.id, "approved")}
                  className="rounded py-2 text-xs font-bold"
                  style={{ backgroundColor: C.abuse, color: C.bg }}
                >
                  공개 승인
                </button>
                <button
                  onClick={() => decideReport(report.id, "rejected")}
                  className="rounded py-2 text-xs font-bold"
                  style={{ border: `1px solid ${C.danger}`, color: C.danger }}
                >
                  반려
                </button>
              </div>
            </div>
          ))}
        {sub === "verify" &&
          verifications.map((verification) => (
            <div
              key={verification.verificationId}
              className="mt-3 rounded p-3"
              style={{
                backgroundColor: C.surface,
                border: `1px solid ${C.line}`,
              }}
            >
              <p className="font-mono text-sm">{verification.gameNickname}</p>
              {verification.evidence?.[0]?.url && (
                <img
                  src={verification.evidence[0].url}
                  alt="게임 계정 인증"
                  className="mt-3 max-h-64 rounded object-contain"
                />
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[
                  ["approved", "승인"],
                  ["rejected", "거절"],
                ].map(([status, label]) => (
                  <button
                    key={status}
                    onClick={() =>
                      decideVerification(verification.verificationId, status)
                    }
                    className="rounded py-2 text-xs font-bold"
                    style={{
                      backgroundColor:
                        status === "approved" ? C.abuse : "transparent",
                      color: status === "approved" ? C.bg : C.danger,
                      border: `1px solid ${status === "approved" ? C.abuse : C.danger}`,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        {sub === "users" &&
          users.map((user) => (
            <div
              key={user.discordUserId}
              className="mt-3 flex items-center gap-2 rounded p-3"
              style={{
                backgroundColor: C.surface,
                border: `1px solid ${C.line}`,
              }}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-sm">
                {user.gameNickname || user.discordUsernameSnapshot}
              </span>
              <button
                onClick={() => toggleBan(user)}
                className="rounded px-3 py-2 text-xs font-bold"
                style={{
                  border: `1px solid ${user.banned ? C.abuse : C.danger}`,
                }}
              >
                {user.banned ? "정지 해제" : "정지"}
              </button>
            </div>
          ))}
        {sub === "features" && (
          <div className="mt-4 space-y-2">
            {Object.keys(DEFAULT_FEATURE_FLAGS)
              .concat("maintenanceMode")
              .map((key) => (
                <button
                  key={key}
                  disabled={busy}
                  onClick={() => changeFlag(key, !featureFlags[key])}
                  className="flex w-full items-center rounded p-3 text-left"
                  style={{
                    backgroundColor: C.surface,
                    border: `1px solid ${C.line}`,
                  }}
                >
                  <span className="flex-1 font-mono text-xs">{key}</span>
                  <span
                    style={{ color: featureFlags[key] ? C.abuse : C.muted }}
                  >
                    {featureFlags[key] ? "ON" : "OFF"}
                  </span>
                </button>
              ))}
          </div>
        )}
      </div>
    );
  }

  function DiscordApp() {
    const runtime = WR.RUNTIME;
    const [api] = useState(() => WR.createApiClient(runtime.bridgeUrl));
    const [featureFlags, setFeatureFlags] = useState({
      ...DEFAULT_FEATURE_FLAGS,
      maintenanceMode: false,
    });
    const [reports, setReports] = useState([]);
    const [me, setMe] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [tab, setTab] = useState("list");
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [open, setOpen] = useState(null);

    const refresh = async () => {
      setError("");
      const [configResult, reportResult, meResult] = await Promise.all([
        api.request("/api/config"),
        api.request("/api/reports").catch((error) => {
          if (["feature_disabled", "maintenance_mode"].includes(error.code))
            return { reports: [] };
          throw error;
        }),
        api.request("/api/me").catch((error) => {
          if (error.status === 401) return null;
          throw error;
        }),
      ]);
      setFeatureFlags({ ...DEFAULT_FEATURE_FLAGS, ...configResult.config });
      setReports((reportResult.reports || []).map(mapReport));
      setMe(meResult?.user || null);
    };

    useEffect(() => {
      refresh()
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }, []);

    const account = me
      ? {
          ...me.gameAccount,
          status: me.gameAccount?.verificationStatus || "unverified",
        }
      : null;
    const votes = Object.fromEntries(
      reports.map((report) => [
        report.id,
        report.votes || { up: 0, down: 0, score: 0 },
      ]),
    );
    const myVoted = me?.votedReportIds || [];
    const canVote =
      Boolean(me) && account?.status === "approved" && !account?.banned;

    const entries = useMemo(() => {
      const grouped = new Map();
      reports.forEach((report) => {
        const key = norm(report.nickname);
        if (!grouped.has(key))
          grouped.set(key, {
            nickname: report.nickname,
            counts: {},
            reports: [],
            total: 0,
            score: 0,
          });
        const entry = grouped.get(key);
        entry.counts[report.category] =
          (entry.counts[report.category] || 0) + 1;
        entry.reports.push(report);
        entry.total += 1;
        entry.score += report.votes?.score || 0;
      });
      let result = [...grouped.values()];
      if (filter !== "all")
        result = result.filter((item) => item.counts[filter]);
      if (query.trim())
        result = result.filter((item) =>
          norm(item.nickname).includes(norm(query)),
        );
      return result.sort((a, b) => b.score - a.score || b.total - a.total);
    }, [reports, query, filter]);

    const submitReport = async (report, shots) => {
      await api.request("/api/reports", {
        method: "POST",
        body: {
          nickname: report.nickname,
          category: report.category,
          tags: report.tags,
          mode: report.mode,
          occurredAt: report.occurredAt,
          description: report.description,
          revealReporter: report.revealReporter,
          evidence: shots,
        },
      });
      setTab("list");
    };

    const vote = async (reportId, direction) => {
      try {
        await api.request(`/api/reports/${reportId}/votes`, {
          method: "POST",
          body: { direction },
        });
        await refresh();
      } catch (err) {
        setError(err.message);
      }
    };

    const logout = async () => {
      await api.request("/api/auth/logout", { method: "POST" });
      setMe(null);
      setTab("list");
    };

    const tabs = [
      ["list", "명단"],
      ...(featureFlags.reportSubmission ? [["submit", "제보하기"]] : []),
      ...(me?.admin ? [["admin", "관리자"]] : []),
      ...(!me ? [["login", "로그인"]] : [["verify", "내 인증"]]),
    ];

    return (
      <div
        className="min-h-screen font-sans"
        style={{ backgroundColor: C.bg, color: C.text }}
      >
        <div className="mx-auto max-w-2xl">
          <header className="px-4 pb-3 pt-6">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">
                협곡 <span style={{ color: C.gold }}>기록소</span>
              </h1>
              <Chip color={C.abuse}>Discord 운영 모드</Chip>
            </div>
            <p className="mt-1 text-xs" style={{ color: C.muted }}>
              와일드 리프트 비정상 플레이 제보 · 승인 후 공개
            </p>
          </header>
          {me && (
            <div
              className="flex items-center gap-2 px-4 py-2 text-xs"
              style={{ backgroundColor: C.surface }}
            >
              <span className="font-mono">{me.username}</span>
              <Chip color={account?.status === "approved" ? C.abuse : C.gold}>
                {account?.status === "approved"
                  ? "게임 계정 인증됨"
                  : "인증 필요"}
              </Chip>
              <button
                onClick={logout}
                className="ml-auto"
                style={{ color: C.muted }}
              >
                로그아웃
              </button>
            </div>
          )}
          {error && <Notice danger>{error}</Notice>}
          <nav
            className="flex overflow-x-auto"
            style={{ borderBottom: `1px solid ${C.line}` }}
          >
            {tabs.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className="min-w-20 flex-1 py-3 text-sm font-semibold"
                style={{ color: tab === id ? C.gold : C.muted }}
              >
                {label}
              </button>
            ))}
          </nav>
          {loading ? (
            <p
              className="px-4 py-16 text-center text-sm"
              style={{ color: C.muted }}
            >
              불러오는 중…
            </p>
          ) : tab === "login" ? (
            <DiscordLogin api={api} />
          ) : tab === "verify" ? (
            <VerificationForm
              api={api}
              account={account}
              onComplete={refresh}
            />
          ) : tab === "submit" ? (
            !me && featureFlags.authentication ? (
              <DiscordLogin api={api} />
            ) : (
              <SubmitForm
                onSubmit={submitReport}
                session={me?.id}
                account={account}
                featureFlags={featureFlags}
                persistEvidence={false}
              />
            )
          ) : tab === "admin" && me?.admin ? (
            <DiscordAdmin
              api={api}
              featureFlags={featureFlags}
              onFlagsChanged={setFeatureFlags}
              onRefresh={refresh}
            />
          ) : (
            <>
              <div className="px-4 py-4">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="닉네임 검색"
                  className="w-full rounded px-3 py-2 font-mono text-sm outline-none"
                  style={{
                    backgroundColor: C.surface,
                    border: `1px solid ${C.line}`,
                  }}
                />
                <div className="mt-3 flex gap-2 overflow-x-auto">
                  {["all", ...CAT_KEYS].map((key) => (
                    <button
                      key={key}
                      onClick={() => setFilter(key)}
                      className="shrink-0 rounded px-3 py-1.5 text-xs font-semibold"
                      style={{
                        border: `1px solid ${key === "all" ? C.gold : CATS[key].color}`,
                        color: key === "all" ? C.gold : CATS[key].color,
                      }}
                    >
                      {key === "all" ? "전체" : CATS[key].label}
                    </button>
                  ))}
                </div>
              </div>
              {entries.length ? (
                entries.map((entry) => (
                  <PlayerRow
                    key={entry.nickname}
                    entry={entry}
                    expanded={open === entry.nickname}
                    onToggle={() =>
                      setOpen(open === entry.nickname ? null : entry.nickname)
                    }
                    votes={votes}
                    myVoted={myVoted}
                    session={me?.id}
                    canVote={canVote}
                    votingEnabled={featureFlags.voting}
                    onVote={vote}
                    onNeedLogin={() => setTab("login")}
                  />
                ))
              ) : (
                <p
                  className="px-4 py-16 text-center text-sm"
                  style={{ color: C.muted }}
                >
                  공개된 제보가 없습니다.
                </p>
              )}
            </>
          )}
          <footer
            className="px-4 py-8 text-xs leading-relaxed"
            style={{ color: C.muted, borderTop: `1px solid ${C.line}` }}
          >
            제보는 사실로 확정된 내용이 아니며 커뮤니티 평가는 공식 판정이
            아닙니다. 게임 닉네임 외 개인정보 게시는 금지됩니다.
          </footer>
        </div>
      </div>
    );
  }

  window.DiscordApp = DiscordApp;
})();
