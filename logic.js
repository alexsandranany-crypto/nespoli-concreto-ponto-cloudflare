(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NespoliLogic = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

  function parseMoneyInput(value) {
    const raw = String(value ?? "").trim().replace(/\s/g, "").replace(/^R\$/i, "");
    if (!raw) return NaN;
    const normalized = raw.includes(",")
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function timeToMinutes(value) {
    if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
    const [hours, minutes] = value.split(":").map(Number);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function calculateJourney({
    start,
    breakStart,
    breakEnd,
    end,
    dailyRate,
    monthlySalary,
    monthlyHours = 220,
    paymentType = "daily",
    manualValue,
    valueMode = "worked"
  }) {
    const startMinutes = timeToMinutes(start);
    const endRaw = timeToMinutes(end);
    const rate = Number(dailyRate);
    const salary = Number(monthlySalary);
    const hoursPerMonth = Number(monthlyHours);
    const isMonthly = paymentType === "monthly";
    if (startMinutes === null || endRaw === null) {
      return { valid: false, error: "Informe a entrada e a saída final." };
    }
    if (!isMonthly && (!Number.isFinite(rate) || rate <= 0)) {
      return { valid: false, error: "A diária do colaborador precisa ser maior que zero." };
    }
    if (isMonthly && (!Number.isFinite(salary) || salary <= 0)) {
      return { valid: false, error: "O salário mensal precisa ser maior que zero." };
    }
    if (isMonthly && (!Number.isFinite(hoursPerMonth) || hoursPerMonth <= 0)) {
      return { valid: false, error: "Informe uma quantidade válida de horas mensais." };
    }

    let endMinutes = endRaw;
    if (endMinutes <= startMinutes) endMinutes += 1440;
    const elapsedMinutes = endMinutes - startMinutes;
    if (elapsedMinutes > 1440) {
      return { valid: false, error: "A jornada não pode ultrapassar 24 horas." };
    }

    const hasBreakStart = Boolean(breakStart);
    const hasBreakEnd = Boolean(breakEnd);
    if (hasBreakStart !== hasBreakEnd) {
      return { valid: false, error: "Informe a saída e o retorno do intervalo, ou deixe os dois vazios." };
    }

    let breakMinutes = 0;
    if (hasBreakStart && hasBreakEnd) {
      let breakStartMinutes = timeToMinutes(breakStart);
      let breakEndMinutes = timeToMinutes(breakEnd);
      if (breakStartMinutes === null || breakEndMinutes === null) {
        return { valid: false, error: "Confira os horários do intervalo." };
      }
      if (breakStartMinutes < startMinutes) breakStartMinutes += 1440;
      if (breakEndMinutes <= breakStartMinutes) breakEndMinutes += 1440;
      if (breakStartMinutes < startMinutes || breakEndMinutes > endMinutes) {
        return { valid: false, error: "O intervalo precisa estar dentro da jornada." };
      }
      breakMinutes = breakEndMinutes - breakStartMinutes;
    }

    const workedMinutes = elapsedMinutes - breakMinutes;
    if (workedMinutes <= 0) {
      return { valid: false, error: "O total de horas trabalhadas precisa ser maior que zero." };
    }

    const balanceMinutes = workedMinutes - 480;
    const minutesToPay = valueMode === "balance8h" ? balanceMinutes : workedMinutes;
    const hourlyRateRaw = isMonthly ? salary / hoursPerMonth : rate / 8;
    const calculatedValue = roundMoney((hourlyRateRaw / 60) * minutesToPay);
    const hasManualValue = manualValue !== "" && manualValue !== null && manualValue !== undefined;
    const parsedManual = hasManualValue ? Number(manualValue) : null;
    if (hasManualValue && !Number.isFinite(parsedManual)) {
      return { valid: false, error: "Informe um valor manual válido." };
    }
    const finalValue = hasManualValue ? roundMoney(parsedManual) : calculatedValue;

    return {
      valid: true,
      elapsedMinutes,
      breakMinutes,
      workedMinutes,
      balanceMinutes,
      valueMode,
      paymentType: isMonthly ? "monthly" : "daily",
      hourlyRate: roundMoney(hourlyRateRaw),
      calculatedValue,
      manualValue: hasManualValue ? finalValue : null,
      adjustment: hasManualValue ? roundMoney(finalValue - calculatedValue) : 0,
      finalValue
    };
  }

  function formatDuration(totalMinutes) {
    const safe = Math.max(0, Math.round(Number(totalMinutes) || 0));
    const hours = Math.floor(safe / 60);
    const minutes = safe % 60;
    return `${hours}h${String(minutes).padStart(2, "0")}`;
  }

  function formatSignedDuration(totalMinutes) {
    const value = Math.round(Number(totalMinutes) || 0);
    const sign = value > 0 ? "+" : value < 0 ? "−" : "";
    return `${sign}${formatDuration(Math.abs(value))}`;
  }

  function resolveRateHistory(rateHistory, date, fallback = 0) {
    const history = Array.isArray(rateHistory)
      ? [...rateHistory].filter((rate) => Number(rate.dailyRate) > 0).sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))
      : [];
    const applicable = history.filter((rate) => String(rate.startDate) <= date).at(-1) || history[0];
    return Number(applicable?.dailyRate ?? fallback) || 0;
  }

  function summarizePayments(entries = []) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    const paidEntries = safeEntries.filter((entry) => entry?.status === "paid");
    const paidDates = paidEntries.map((entry) => String(entry.paidDate || "")).filter(Boolean).sort();
    const paidCount = paidEntries.length;
    const pendingCount = safeEntries.length - paidCount;
    const status = safeEntries.length > 0 && pendingCount === 0
      ? "paid"
      : paidCount > 0 ? "partial" : "pending";
    return {
      status,
      paidCount,
      pendingCount,
      latestPaidDate: paidDates.at(-1) || ""
    };
  }

  function isAbsence(entry) {
    return entry?.recordType === "absence";
  }

  function getClosePeriod(type, baseDate = new Date()) {
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const day = baseDate.getDate();
    const toISO = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };
    if (type === "close7") {
      const start = day >= 21 ? new Date(year, month, 21) : new Date(year, month - 1, 21);
      const end = day >= 21 ? new Date(year, month + 1, 7) : new Date(year, month, 7);
      return { start: toISO(start), end: toISO(end) };
    }
    if (type === "close20") {
      const targetMonth = day < 8 ? month - 1 : month;
      return { start: toISO(new Date(year, targetMonth, 8)), end: toISO(new Date(year, targetMonth, 20)) };
    }
    if (type === "month") {
      return { start: toISO(new Date(year, month, 1)), end: toISO(new Date(year, month + 1, 0)) };
    }
    return { start: "", end: "" };
  }

  return { calculateJourney, formatDuration, formatSignedDuration, resolveRateHistory, summarizePayments, isAbsence, getClosePeriod, parseMoneyInput, roundMoney, timeToMinutes };
});
