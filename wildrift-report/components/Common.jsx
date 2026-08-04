(function () {
  const { useState, useRef } = React;
  const { C, CATS, CAT_KEYS, compress } = WR;
  function SinglePhotoPicker({ value, onChange, label = "사진 선택" }) {
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const ref = useRef(null);

    const pick = async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      setBusy(true);
      setErr("");
      try {
        onChange(await compress(f));
      } catch (ex) {
        setErr(ex.message || "사진을 처리하지 못했습니다.");
      }
      setBusy(false);
    };

    return (
      <div>
        <div className="flex items-center gap-3">
          <div className="relative h-20 w-20 shrink-0">
            <input
              ref={ref}
              type="file"
              accept="image/*"
              onChange={pick}
              disabled={busy}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            {value ? (
              <img
                src={value}
                alt="선택된 사진"
                className="h-20 w-20 rounded object-cover"
                style={{ border: `1px solid ${C.line}` }}
              />
            ) : (
              <div
                className="pointer-events-none flex h-full w-full items-center justify-center rounded text-2xl"
                style={{ border: `1px dashed ${C.line}`, color: C.muted }}
              >
                {busy ? "…" : "+"}
              </div>
            )}
          </div>
          <div className="flex-1">
            <p className="text-xs" style={{ color: C.muted }}>
              {label}
            </p>
            <button
              type="button"
              onClick={() => ref.current && ref.current.click()}
              className="mt-1 rounded px-2 py-1 text-xs"
              style={{ border: `1px solid ${C.line}`, color: C.muted }}
            >
              선택창이 안 열리면 여기
            </button>
          </div>
        </div>
        {err && (
          <p className="mt-2 text-xs" style={{ color: C.danger }}>
            {err}
          </p>
        )}
      </div>
    );
  }

  function Chip({ children, color = C.muted, solid = false }) {
    return (
      <span
        className="inline-block rounded px-2 py-0.5 text-xs"
        style={
          solid
            ? { backgroundColor: color, color: C.bg, fontWeight: 600 }
            : {
                border: `1px solid ${color}55`,
                color,
                backgroundColor: `${color}14`,
              }
        }
      >
        {children}
      </span>
    );
  }

  function SpectrumBar({ counts }) {
    const total = CAT_KEYS.reduce((s, k) => s + (counts[k] || 0), 0) || 1;
    return (
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: C.line }}
      >
        {CAT_KEYS.map((k) =>
          counts[k] ? (
            <div
              key={k}
              style={{
                width: `${(counts[k] / total) * 100}%`,
                backgroundColor: CATS[k].color,
              }}
            />
          ) : null,
        )}
      </div>
    );
  }

  function TrustBadge({ score }) {
    const color = score > 0 ? C.abuse : score < 0 ? C.danger : C.muted;
    const label =
      score > 0
        ? `신뢰도 +${score}`
        : score < 0
          ? `신뢰도 ${score}`
          : "신뢰도 —";
    return <Chip color={color}>{label}</Chip>;
  }

  window.SinglePhotoPicker = SinglePhotoPicker;
  window.Chip = Chip;
  window.SpectrumBar = SpectrumBar;
  window.TrustBadge = TrustBadge;
})();
