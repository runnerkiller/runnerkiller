window.WR = window.WR || {};
(function () {
  WR.scanPII = (t) => WR.PII_RULES.filter((r) => r.re.test(t || ""));
  WR.norm = (n) => n.trim().toLowerCase().replace(/\s+/g, " ");
  WR.fmtDate = (iso) => (iso ? iso.slice(0, 10).replace(/-/g, ".") : "—");

  WR.compress = function compress(file, maxDim = 1100, quality = 0.62) {
    return new Promise((resolve, reject) => {
      if (!file.type || !file.type.startsWith("image/")) {
        reject(new Error("이미지 파일이 아닙니다"));
        return;
      }
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
            canvas
              .getContext("2d")
              .drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", quality));
          } catch {
            resolve(dataUrl);
          }
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  };
})();
