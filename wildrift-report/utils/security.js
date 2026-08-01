window.WR = window.WR || {};
WR.scanPII = (t) => WR.PII_RULES.filter((r) => r.re.test(t || ""));
WR.uid = () => Math.random().toString(36).slice(2, 10);
WR.norm = (n) => n.trim().toLowerCase().replace(/\s+/g, " ");
WR.fmtDate = (iso) => (iso ? iso.slice(0, 10).replace(/-/g, ".") : "—");
WR.fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
WR.fallbackHash = function fallbackHash(text) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).repeat(2);
}

WR.hashPass = async function hashPass(text) {
  const salted = `wr::${text}`;
  try {
    if (window.crypto && window.crypto.subtle && window.isSecureContext) {
      const buf = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(salted));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch { /* 아래 대체 구현 사용 */ }
  return fallbackHash(salted);
}

WR.compress = function compress(file, maxDim = 1100, quality = 0.62) {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith("image/")) { reject(new Error("이미지 파일이 아닙니다")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다"));
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onerror = () => resolve(dataUrl);
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch { resolve(dataUrl); }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
