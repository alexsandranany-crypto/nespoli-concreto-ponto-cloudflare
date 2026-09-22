const assert = require("node:assert/strict");
const { calculateJourney, formatDuration, formatSignedDuration, resolveRateHistory, summarizePayments, summarizeOutstanding, isAbsence, getClosePeriod, getFifthWeekdayPaymentDate, parseMoneyInput } = require("./logic.js");

assert.equal(parseMoneyInput("18,00"), 18);
assert.equal(parseMoneyInput("49.99"), 49.99);
assert.equal(parseMoneyInput("1.234,56"), 1234.56);
assert.equal(Number.isNaN(parseMoneyInput("")), true);

const standard = calculateJourney({ start: "06:00", breakStart: "11:00", breakEnd: "12:00", end: "15:00", dailyRate: 180, manualValue: null });
assert.equal(standard.valid, true);
assert.equal(standard.workedMinutes, 480);
assert.equal(standard.finalValue, 180);

const overtime = calculateJourney({ start: "06:00", breakStart: "11:00", breakEnd: "12:00", end: "17:00", dailyRate: 180, manualValue: null });
assert.equal(overtime.workedMinutes, 600);
assert.equal(overtime.finalValue, 225);

const manual = calculateJourney({ start: "06:00", breakStart: "11:00", breakEnd: "12:00", end: "15:00", dailyRate: 180, manualValue: 28.13 });
assert.equal(manual.calculatedValue, 180);
assert.equal(manual.finalValue, 28.13);
assert.equal(manual.adjustment, -151.87);

const noBreak = calculateJourney({ start: "08:00", breakStart: "", breakEnd: "", end: "12:30", dailyRate: 100, manualValue: null });
assert.equal(noBreak.workedMinutes, 270);
assert.equal(noBreak.finalValue, 56.25);

const overnight = calculateJourney({ start: "20:00", breakStart: "00:00", breakEnd: "01:00", end: "05:00", dailyRate: 160, manualValue: null });
assert.equal(overnight.workedMinutes, 480);
assert.equal(overnight.finalValue, 160);

const invalidBreak = calculateJourney({ start: "08:00", breakStart: "12:00", breakEnd: "", end: "17:00", dailyRate: 100, manualValue: null });
assert.equal(invalidBreak.valid, false);

const owedHours = calculateJourney({ start: "06:00", breakStart: "", breakEnd: "", end: "12:46", dailyRate: 120, manualValue: null, valueMode: "balance8h" });
assert.equal(owedHours.workedMinutes, 406);
assert.equal(owedHours.balanceMinutes, -74);
assert.equal(owedHours.finalValue, -18.5);
assert.equal(formatSignedDuration(owedHours.balanceMinutes), "−1h14");

const negativeManual = calculateJourney({ start: "06:00", breakStart: "", breakEnd: "", end: "12:46", dailyRate: 120, manualValue: -20, valueMode: "balance8h" });
assert.equal(negativeManual.valid, true);
assert.equal(negativeManual.finalValue, -20);

const monthly = calculateJourney({
  start: "08:00", breakStart: "12:00", breakEnd: "13:00", end: "17:00",
  paymentType: "monthly", monthlySalary: 2200, monthlyHours: 220, manualValue: null
});
assert.equal(monthly.valid, true);
assert.equal(monthly.workedMinutes, 480);
assert.equal(monthly.hourlyRate, 10);
assert.equal(monthly.finalValue, 80);

const monthlyBalance = calculateJourney({
  start: "06:00", breakStart: "", breakEnd: "", end: "12:46",
  paymentType: "monthly", monthlySalary: 2200, monthlyHours: 220, manualValue: null, valueMode: "balance8h"
});
assert.equal(monthlyBalance.balanceMinutes, -74);
assert.equal(monthlyBalance.finalValue, -12.33);

const rateHistory = [
  { startDate: "0000-01-01", dailyRate: 120 },
  { startDate: "2026-09-13", dailyRate: 150 }
];
assert.equal(resolveRateHistory(rateHistory, "2026-09-12"), 120);
assert.equal(resolveRateHistory(rateHistory, "2026-09-13"), 150);
assert.equal(formatDuration(485), "8h05");
assert.deepEqual(getClosePeriod("close20", new Date(2026, 8, 14)), { start: "2026-09-08", end: "2026-09-20" });
assert.deepEqual(getClosePeriod("close7", new Date(2026, 8, 14)), { start: "2026-08-21", end: "2026-09-07" });
assert.equal(getFifthWeekdayPaymentDate("2026-09-21"), "2026-10-07");
assert.equal(getFifthWeekdayPaymentDate("2026-12-31"), "2027-01-07");
assert.equal(getFifthWeekdayPaymentDate("data-invalida"), "");

assert.deepEqual(summarizePayments([
  { status: "pending" },
  { status: "pending" }
]), { status: "pending", paidCount: 0, pendingCount: 2, latestPaidDate: "" });
assert.deepEqual(summarizePayments([
  { status: "paid", paidDate: "2026-09-18" },
  { status: "pending" }
]), { status: "partial", paidCount: 1, pendingCount: 1, latestPaidDate: "2026-09-18" });
assert.deepEqual(summarizePayments([
  { status: "paid", paidDate: "2026-09-17" },
  { status: "paid", paidDate: "2026-09-19" }
]), { status: "paid", paidCount: 2, pendingCount: 0, latestPaidDate: "2026-09-19" });
assert.deepEqual(summarizeOutstanding([
  { employeeId: "alice", status: "pending", finalValue: 978.25 },
  { employeeId: "joao", status: "paid", finalValue: 480 }
], [
  { employeeId: "alice", value: 49.99 },
  { employeeId: "joao", value: 609.58 }
]), {
  pendingGross: 978.25,
  pendingAdvances: 49.99,
  pendingNet: 928.26,
  pendingEmployeeCount: 1
});
assert.deepEqual(summarizeOutstanding([
  { employeeId: "alice", status: "paid", finalValue: 978.25 }
], [
  { employeeId: "alice", value: 49.99 }
]), {
  pendingGross: 0,
  pendingAdvances: 0,
  pendingNet: 0,
  pendingEmployeeCount: 0
});
assert.equal(isAbsence({ recordType: "absence" }), true);
assert.equal(isAbsence({ recordType: "work" }), false);
assert.equal(isAbsence({}), false);

console.log("Todos os testes de cálculo passaram.");
