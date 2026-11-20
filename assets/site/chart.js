// Stitched historical daily settled USDC chart (Original + Phala TEE seller)
// Built strictly with createElementNS + textContent (no innerHTML sinks).
// Legend and switchover label sit inside the SVG itself (no captions outside the visual).

const SVG_NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, text = "") {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, String(v));
  }
  if (text) node.textContent = text;
  return node;
}

export function stitchDailySeries(originalDays = [], currentDays = []) {
  const byDay = new Map();
  let teeStartDay = null;

  for (const d of originalDays) {
    if (!d?.day) continue;
    byDay.set(d.day, {
      day: d.day,
      origUsd: Number(d.settled_micro || 0) / 1e6,
      teeUsd: 0,
      settles: Number(d.settles || 0),
      buyers: Number(d.buyers || 0)
    });
  }
  for (const d of currentDays) {
    if (!d?.day) continue;
    if (!teeStartDay || d.day < teeStartDay) teeStartDay = d.day;
    const prev = byDay.get(d.day) || {
      day: d.day,
      origUsd: 0,
      teeUsd: 0,
      settles: 0,
      buyers: 0
    };
    prev.teeUsd += Number(d.settled_micro || 0) / 1e6;
    prev.settles += Number(d.settles || 0);
    prev.buyers += Number(d.buyers || 0);
    byDay.set(d.day, prev);
  }

  const sorted = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  return { series: sorted, teeStartDay: teeStartDay || "2026-11-18" };
}

function fmtShortDate(isoDay) {
  const [y, m, d] = isoDay.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function renderDailyChart(container, readoutEl, originalDays, currentDays) {
  if (!container) return;
  const { series, teeStartDay } = stitchDailySeries(originalDays, currentDays);
  container.replaceChildren();

  if (!series.length) {
    const empty = document.createElement("p");
    empty.className = "t-small";
    empty.textContent = "No daily settlement history available yet.";
    container.append(empty);
    return;
  }

  const visible = series.length > 90 ? series.slice(-90) : series;
  const maxUsd = Math.max(...visible.map((d) => d.origUsd + d.teeUsd), 1);
  const yMax = Math.ceil(maxUsd / 5) * 5;

  const isNarrow = container.clientWidth > 0 && container.clientWidth < 500;
  const W = isNarrow ? 340 : 960;
  const H = isNarrow ? 260 : 170;
  const padL = 40;
  const padR = 12;
  const padT = isNarrow ? 44 : 28;
  const padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const svg = el("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": `Daily settled USDC chart from ${fmtShortDate(visible[0].day)} to ${fmtShortDate(visible.at(-1).day)}, showing switchover to Phala TEE seller on ${fmtShortDate(teeStartDay)}.`
  });

  // Inline SVG title & legend (top inside SVG so zero outside caption is needed)
  svg.append(
    el(
      "text",
      {
        x: padL,
        y: 13,
        fill: "#1f1916",
        "font-family": "Funnel Sans, system-ui, sans-serif",
        "font-size": isNarrow ? 11.5 : 12.5,
        "font-weight": 500
      },
      isNarrow ? "Daily settled USDC (UTC)" : "Daily settled USDC (UTC, last 90 active days)"
    )
  );
  // Legend swatches
  const legY = isNarrow ? 26 : 13;
  const legX1 = isNarrow ? padL : W - 266;
  const legX2 = isNarrow ? padL + 116 : W - 152;
  svg.append(el("rect", { x: legX1, y: legY - 8, width: 9, height: 9, rx: 2, fill: "#a84832" }));
  svg.append(
    el(
      "text",
      {
        x: legX1 + 14,
        y: legY,
        fill: "#1f1916",
        "font-family": "Funnel Sans, system-ui, sans-serif",
        "font-size": 11
      },
      "Original seller"
    )
  );
  svg.append(el("rect", { x: legX2, y: legY - 8, width: 9, height: 9, rx: 2, fill: "#2a7f7e" }));
  svg.append(
    el(
      "text",
      {
        x: legX2 + 14,
        y: legY,
        fill: "#1f1916",
        "font-family": "Funnel Sans, system-ui, sans-serif",
        "font-size": 11
      },
      "Current · Phala TEE"
    )
  );

  // Gridlines + Y labels
  const ticks = [0, yMax / 2, yMax];
  for (const val of ticks) {
    const y = padT + plotH - (val / yMax) * plotH;
    svg.append(
      el("line", {
        x1: padL,
        y1: y.toFixed(1),
        x2: W - padR,
        y2: y.toFixed(1),
        stroke: "rgba(31, 25, 22, 0.12)",
        "stroke-width": 1
      })
    );
    svg.append(
      el(
        "text",
        {
          x: padL - 8,
          y: (y + 4).toFixed(1),
          "text-anchor": "end",
          fill: "#1f1916",
          "font-family": "DM Mono, monospace",
          "font-size": 11
        },
        `$${val.toFixed(0)}`
      )
    );
  }

  const slotW = plotW / visible.length;
  const barW = Math.max(2.5, slotW * 0.72);
  const teeIndex = visible.findIndex((d) => d.day >= teeStartDay);

  const defaultReadout = `Last ${visible.length} active UTC days (${fmtShortDate(visible[0].day)} – ${fmtShortDate(visible.at(-1).day)}). Hover any bar to inspect daily settles.`;
  if (readoutEl) readoutEl.textContent = defaultReadout;

  visible.forEach((d, i) => {
    const x = padL + i * slotW + (slotW - barW) / 2;
    const total = d.origUsd + d.teeUsd;
    const totalH = Math.max(2, (total / yMax) * plotH);
    const teeH = d.teeUsd > 0 ? Math.max(2, (d.teeUsd / yMax) * plotH) : 0;
    const origH = Math.max(0, totalH - teeH);
    const yTop = padT + plotH - totalH;

    const g = el("g", { class: "chart-bar" });
    g.append(
      el("title", {}, `${d.day} (UTC): $${total.toFixed(2)} gross USDC · ${d.settles} settles`)
    );

    if (origH > 0) {
      g.append(
        el("rect", {
          x: x.toFixed(1),
          y: (padT + plotH - origH).toFixed(1),
          width: barW.toFixed(1),
          height: origH.toFixed(1),
          rx: 1.5,
          fill: "#a84832"
        })
      );
    }
    if (teeH > 0) {
      g.append(
        el("rect", {
          x: x.toFixed(1),
          y: yTop.toFixed(1),
          width: barW.toFixed(1),
          height: teeH.toFixed(1),
          rx: 1.5,
          fill: "#2a7f7e"
        })
      );
    }

    const showDetail = () => {
      if (!readoutEl) return;
      const parts = [`${d.day} (UTC): $${total.toFixed(2)} gross USDC · ${d.settles} settles`];
      if (d.teeUsd > 0 && d.origUsd > 0) {
        parts.push(`Original $${d.origUsd.toFixed(2)} + TEE $${d.teeUsd.toFixed(2)}`);
      } else if (d.teeUsd > 0) {
        parts.push("Current · Phala TEE");
      } else {
        parts.push("Original seller");
      }
      readoutEl.textContent = parts.join(" · ");
    };

    g.addEventListener("mouseenter", showDetail);
    svg.append(g);
  });

  // TEE Switchover vertical callout
  if (teeIndex >= 0) {
    const sx = padL + teeIndex * slotW;
    svg.append(
      el("line", {
        x1: sx.toFixed(1),
        y1: padT - 4,
        x2: sx.toFixed(1),
        y2: padT + plotH,
        stroke: "#2a7f7e",
        "stroke-width": 1.5,
        "stroke-dasharray": "4 3"
      })
    );
    const labelX = Math.min(W - padR - 4, Math.max(padL + 110, sx - 6));
    svg.append(
      el(
        "text",
        {
          x: labelX.toFixed(1),
          y: padT + 10,
          "text-anchor": "end",
          fill: "#1c5857",
          "font-family": "DM Mono, monospace",
          "font-size": 11,
          "font-weight": 500
        },
        `TEE switchover (${fmtShortDate(teeStartDay)}) →`
      )
    );
  }

  // Sparse X-axis dates
  const xStops = [0, Math.floor(visible.length * 0.33), Math.floor(visible.length * 0.66), visible.length - 1];
  const seen = new Set();
  for (const idx of xStops) {
    if (seen.has(idx) || !visible[idx]) continue;
    seen.add(idx);
    const x = padL + idx * slotW + slotW / 2;
    const anchor = idx === 0 ? "start" : idx === visible.length - 1 ? "end" : "middle";
    svg.append(
      el(
        "text",
        {
          x: x.toFixed(1),
          y: H - 6,
          "text-anchor": anchor,
          fill: "#1f1916",
          "font-family": "DM Mono, monospace",
          "font-size": 11
        },
        fmtShortDate(visible[idx].day)
      )
    );
  }

  container.append(svg);
}
