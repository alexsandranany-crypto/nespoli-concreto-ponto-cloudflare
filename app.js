(() => {
  "use strict";
  const L = window.NespoliLogic;
  const STORAGE_KEY = "nespoli_concreto_ponto_v1";
  const CLOUD_REQUEST_TIMEOUT = 20000;
  const CLOUD_RETRY_DELAYS = [0, 900, 2400];
  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const escapeHTML = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const dateBR = (iso) => iso ? iso.split("-").reverse().join("/") : "—";
  const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  const defaultState = () => ({ version: 5, employees: [], entries: [], advances: [], updatedAt: new Date().toISOString() });
  let state = loadState();
  let activePeriod = "close20";
  let activeRateEmployeeId = null;
  let activeBulkPaymentEntryIds = [];
  let toastTimer;
  let cloudRevision = 0;
  let cloudInitialized = false;
  let cloudTimer;
  let cloudWriting = false;
  let cloudWriteAgain = false;
  let cloudRefreshPromise = null;

  const dom = {
    saveStatus: $("#saveStatus"), periodLabel: $("#periodLabel"), statEmployees: $("#statEmployees"), statEntries: $("#statEntries"),
    statHours: $("#statHours"), statTotal: $("#statTotal"), statAdvances: $("#statAdvances"), statPending: $("#statPending"), statPaid: $("#statPaid"),
    entryForm: $("#entryForm"), entryId: $("#entryId"), employeeSelect: $("#employeeSelect"), workDate: $("#workDate"), recordType: $("#recordType"),
    startTime: $("#startTime"), breakStart: $("#breakStart"), breakEnd: $("#breakEnd"), endTime: $("#endTime"),
    valueMode: $("#valueMode"), manualValue: $("#manualValue"), manualReason: $("#manualReason"), notes: $("#notes"), paymentStatus: $("#paymentStatus"),
    paymentStatusField: $("#paymentStatusField"), paymentDateField: $("#paymentDateField"), paymentDate: $("#paymentDate"),
    timeGrid: $("#timeGrid"), calculationMode: $("#calculationMode"), calcPreview: $("#calcPreview"), absenceFormNotice: $("#absenceFormNotice"),
    previewHours: $("#previewHours"), previewCalculated: $("#previewCalculated"), previewFinal: $("#previewFinal"), formulaNote: $("#formulaNote"), notesLabel: $("#notesLabel"), entryFormTitle: $("#entryFormTitle"),
    rateHint: $("#rateHint"), adjustmentBox: $("#adjustmentBox"), formError: $("#formError"), formMode: $("#formMode"),
    saveEntryBtn: $("#saveEntryBtn"), cancelEditBtn: $("#cancelEditBtn"), filterEmployee: $("#filterEmployee"), filterStart: $("#filterStart"),
    filterEnd: $("#filterEnd"), filterStatus: $("#filterStatus"), recordsList: $("#recordsList"), emptyState: $("#emptyState"),
    absenceAlert: $("#absenceAlert"), absenceAlertText: $("#absenceAlertText"),
    employeesDialog: $("#employeesDialog"), employeeForm: $("#employeeForm"), employeeId: $("#employeeId"), employeeName: $("#employeeName"),
    employeeRate: $("#employeeRate"), employeeRateField: $("#employeeRateField"), employeePaymentType: $("#employeePaymentType"),
    employeeMonthlyFields: $("#employeeMonthlyFields"), employeeMonthlySalary: $("#employeeMonthlySalary"), employeeMonthlyHours: $("#employeeMonthlyHours"),
    employeeError: $("#employeeError"), employeesList: $("#employeesList"), saveEmployeeBtn: $("#saveEmployeeBtn"),
    cancelEmployeeEditBtn: $("#cancelEmployeeEditBtn"), backupDialog: $("#backupDialog"), backupFile: $("#backupFile"), backupMeta: $("#backupMeta"),
    backupText: $("#backupText"),
    reportDialog: $("#reportDialog"), reportEmployeeSelect: $("#reportEmployeeSelect"), reportSelectionSummary: $("#reportSelectionSummary"),
    whatsappText: $("#whatsappText"), printableReport: $("#printableReport"), filtersPanel: $("#filtersPanel"),
    ratesDialog: $("#ratesDialog"), ratesEmployeeName: $("#ratesEmployeeName"), rateForm: $("#rateForm"), rateId: $("#rateId"),
    rateStartDate: $("#rateStartDate"), rateValue: $("#rateValue"), rateError: $("#rateError"), ratesList: $("#ratesList"),
    saveRateBtn: $("#saveRateBtn"), cancelRateEditBtn: $("#cancelRateEditBtn"), advancesDialog: $("#advancesDialog"),
    advanceForm: $("#advanceForm"), advanceId: $("#advanceId"), advanceEmployee: $("#advanceEmployee"), advanceDate: $("#advanceDate"),
    advanceValue: $("#advanceValue"), advanceNote: $("#advanceNote"), advanceError: $("#advanceError"), advancesList: $("#advancesList"),
    advanceFilterEmployee: $("#advanceFilterEmployee"), advanceFilterEmployees: $("#advanceFilterEmployees"),
    advanceFilterStart: $("#advanceFilterStart"), advanceFilterEnd: $("#advanceFilterEnd"), advanceFilterPeriod: $("#advanceFilterPeriod"),
    advanceFilterSelection: $("#advanceFilterSelection"), advanceFilterCount: $("#advanceFilterCount"), advanceFilterTotal: $("#advanceFilterTotal"),
    saveAdvanceBtn: $("#saveAdvanceBtn"), cancelAdvanceEditBtn: $("#cancelAdvanceEditBtn"),
    bulkPaymentDialog: $("#bulkPaymentDialog"), bulkPaymentForm: $("#bulkPaymentForm"), bulkPaymentEmployeeName: $("#bulkPaymentEmployeeName"),
    bulkPaymentSummary: $("#bulkPaymentSummary"), bulkPaymentDate: $("#bulkPaymentDate"), bulkPaymentError: $("#bulkPaymentError"), toast: $("#toast")
  };

  init();

  function init() {
    dom.workDate.value = todayISO();
    dom.paymentDate.value = todayISO();
    bindEvents();
    updateRecordTypeFields();
    applyQuickPeriod("close20");
    renderAll();
    updatePreview();
    setSaveStatus("syncing", "Conectando à nuvem…");
    initializeCloudSync();
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (parsed && Array.isArray(parsed.employees) && Array.isArray(parsed.entries)) {
        const localHasData = Boolean(parsed.employees.length || parsed.entries.length || parsed.advances?.length);
        const bundled = window.NESPOLI_INITIAL_STATE;
        const bundledHasData = Boolean(bundled?.employees?.length || bundled?.entries?.length || bundled?.advances?.length);
        if (localHasData || !bundledHasData) return normalizeState(parsed);
      }
    } catch (error) {
      console.warn("Backup local inválido", error);
    }
    return defaultState();
  }

  function normalizeState(data) {
    data.version = 5;
    data.advances = Array.isArray(data.advances) ? data.advances : [];
    data.updatedAt = data.updatedAt || new Date(0).toISOString();
    data.employees = data.employees.map((employee) => {
      const paymentType = employee.paymentType === "monthly" ? "monthly" : "daily";
      const history = Array.isArray(employee.rateHistory) && employee.rateHistory.length
        ? employee.rateHistory
        : paymentType === "daily" ? [{ id: uid(), startDate: "0000-01-01", dailyRate: Number(employee.dailyRate) || 0 }] : [];
      const normalizedHistory = history
        .map((rate) => ({ id: rate.id || uid(), startDate: rate.startDate || "0000-01-01", dailyRate: L.roundMoney(Number(rate.dailyRate ?? rate.rate) || 0) }))
        .filter((rate) => rate.dailyRate > 0)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      return {
        ...employee,
        paymentType,
        dailyRate: normalizedHistory.at(-1)?.dailyRate || Number(employee.dailyRate) || 0,
        rateHistory: normalizedHistory,
        monthlySalary: L.roundMoney(Number(employee.monthlySalary) || 0),
        monthlyHours: Number(employee.monthlyHours) > 0 ? Number(employee.monthlyHours) : 220
      };
    });
    data.entries = data.entries.map((entry) => {
      const status = entry.status === "paid" ? "paid" : "pending";
      return {
        ...entry,
        recordType: entry.recordType === "absence" ? "absence" : "work",
        status,
        paidDate: status === "paid" ? String(entry.paidDate || entry.paymentDate || "") : ""
      };
    });
    return data;
  }

  function saveState() {
    state.updatedAt = new Date().toISOString();
    persistLocalState();
    setSaveStatus("syncing", "Salvo neste aparelho • sincronizando…");
    scheduleCloudSave();
  }

  function persistLocalState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function hasBusinessData(data) {
    return Boolean(data?.employees?.length || data?.entries?.length || data?.advances?.length);
  }

  function setSaveStatus(kind, text) {
    dom.saveStatus.className = `save-status ${kind}`;
    dom.saveStatus.innerHTML = `<span class="status-dot"></span> ${text}`;
    dom.saveStatus.disabled = kind === "syncing";
    dom.saveStatus.title = kind === "offline"
      ? "Toque para tentar conectar novamente"
      : kind === "synced" ? "Toque para atualizar os dados da nuvem" : "Conectando à nuvem";
  }

  function scheduleCloudSave(delay = 450) {
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(() => {
      if (cloudInitialized) pushCloudState();
      else initializeCloudSync();
    }, delay);
  }

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function cloudRequest(options = {}) {
    let lastError;
    for (let attempt = 0; attempt < CLOUD_RETRY_DELAYS.length; attempt += 1) {
      if (CLOUD_RETRY_DELAYS[attempt]) await wait(CLOUD_RETRY_DELAYS[attempt]);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CLOUD_REQUEST_TIMEOUT);
      try {
        const response = await fetch("/api/state", { ...options, signal: controller.signal, cache: "no-store" });
        if (response.status >= 500 && attempt < CLOUD_RETRY_DELAYS.length - 1) {
          lastError = new Error(`Falha temporária na nuvem (${response.status})`);
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt === CLOUD_RETRY_DELAYS.length - 1) throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError || new Error("Não foi possível conectar à nuvem.");
  }

  async function fetchCloudState() {
    const response = await cloudRequest({ headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Falha ao consultar a nuvem (${response.status})`);
    return response.json();
  }

  async function initializeCloudSync() {
    if (cloudRefreshPromise) return cloudRefreshPromise;
    cloudRefreshPromise = (async () => {
      try {
        setSaveStatus("syncing", "Sincronizando…");
        const cloud = await fetchCloudState();
        cloudRevision = Number(cloud.revision) || 0;
        cloudInitialized = true;
        const cloudState = cloud.state && Array.isArray(cloud.state.employees) && Array.isArray(cloud.state.entries)
          ? normalizeState(cloud.state)
          : null;
        const localTime = new Date(state.updatedAt || 0).getTime();
        const cloudTime = new Date(cloudState?.updatedAt || 0).getTime();

        if (cloudState && (!hasBusinessData(state) || cloudTime > localTime)) {
          state = cloudState;
          persistLocalState();
          resetEntryForm();
          renderAll();
          updatePreview();
        } else if (hasBusinessData(state) && (!cloudState || localTime > cloudTime)) {
          await pushCloudState();
          return;
        }
        setSaveStatus("synced", "Dados salvos na nuvem");
      } catch (error) {
        console.warn("Sincronização indisponível", error);
        cloudInitialized = false;
        setSaveStatus("offline", "Sem conexão • toque para tentar");
        if (navigator.onLine) scheduleCloudSave(15000);
      } finally {
        cloudRefreshPromise = null;
      }
    })();
    return cloudRefreshPromise;
  }

  async function pushCloudState() {
    if (!cloudInitialized) return initializeCloudSync();
    if (cloudWriting) {
      cloudWriteAgain = true;
      return;
    }
    cloudWriting = true;
    const snapshotUpdatedAt = state.updatedAt;
    try {
      setSaveStatus("syncing", "Salvo neste aparelho • sincronizando…");
      const response = await cloudRequest({
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ state, baseRevision: cloudRevision })
      });
      const result = await response.json();
      if (response.status === 409) {
        cloudRevision = Number(result.revision) || 0;
        const cloudState = result.state && Array.isArray(result.state.employees) && Array.isArray(result.state.entries)
          ? normalizeState(result.state)
          : null;
        if (cloudState && new Date(cloudState.updatedAt || 0).getTime() > new Date(state.updatedAt || 0).getTime()) {
          state = cloudState;
          persistLocalState();
          resetEntryForm();
          renderAll();
          updatePreview();
          setSaveStatus("synced", "Dados salvos na nuvem");
        } else {
          cloudWriteAgain = true;
        }
        return;
      }
      if (!response.ok) throw new Error(result.error || `Falha ao salvar (${response.status})`);
      cloudRevision = Number(result.revision) || cloudRevision;
      if (state.updatedAt !== snapshotUpdatedAt) cloudWriteAgain = true;
      else setSaveStatus("synced", "Dados salvos na nuvem");
    } catch (error) {
      console.warn("Não foi possível salvar na nuvem", error);
      cloudInitialized = false;
      setSaveStatus("offline", "Sem conexão • toque para tentar");
      if (navigator.onLine) scheduleCloudSave(15000);
    } finally {
      cloudWriting = false;
      if (cloudWriteAgain) {
        cloudWriteAgain = false;
        scheduleCloudSave(50);
      }
    }
  }

  function bindEvents() {
    $("#manageEmployeesBtn").addEventListener("click", openEmployees);
    $("#quickAddEmployeeBtn").addEventListener("click", openEmployees);
    $("#backupBtn").addEventListener("click", () => { updateBackupMeta(); dom.backupDialog.showModal(); });
    $("#advancesBtn").addEventListener("click", openAdvances);
    $("#reportBtn").addEventListener("click", openReport);
    $("#exportBackupBtn").addEventListener("click", exportBackup);
    $("#restoreBundledBackupBtn").addEventListener("click", restoreBundledBackup);
    $("#copyBackupBtn").addEventListener("click", copyBackupData);
    $("#importBackupBtn").addEventListener("click", () => dom.backupFile.click());
    dom.backupFile.addEventListener("change", importBackup);
    $("#restoreBackupTextBtn").addEventListener("click", restoreBackupText);
    $("#copyWhatsappBtn").addEventListener("click", copyWhatsapp);
    $("#exportCsvBtn").addEventListener("click", exportCSV);
    $("#printReportBtn").addEventListener("click", () => { if (!$("#printReportBtn").disabled) window.print(); });
    dom.reportEmployeeSelect.addEventListener("change", refreshReportPreview);
    $("#toggleFiltersBtn").addEventListener("click", () => dom.filtersPanel.classList.toggle("open"));
    $("#clearFiltersBtn").addEventListener("click", () => applyQuickPeriod("all"));
    $$("[data-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
    $$(".dialog").forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));
    $$("[data-period]").forEach((button) => button.addEventListener("click", () => applyQuickPeriod(button.dataset.period)));

    dom.employeeSelect.addEventListener("change", updatePreview);
    dom.workDate.addEventListener("change", updatePreview);
    [dom.startTime, dom.breakStart, dom.breakEnd, dom.endTime, dom.manualValue].forEach((input) => input.addEventListener("input", updatePreview));
    dom.valueMode.addEventListener("change", updatePreview);
    dom.recordType.addEventListener("change", updateRecordTypeFields);
    dom.paymentStatus.addEventListener("change", updatePaymentDateField);
    dom.entryForm.addEventListener("submit", saveEntry);
    dom.cancelEditBtn.addEventListener("click", resetEntryForm);
    dom.employeeForm.addEventListener("submit", saveEmployee);
    dom.employeePaymentType.addEventListener("change", updateEmployeePaymentFields);
    dom.cancelEmployeeEditBtn.addEventListener("click", resetEmployeeForm);
    dom.rateForm.addEventListener("submit", saveRate);
    dom.cancelRateEditBtn.addEventListener("click", resetRateForm);
    dom.ratesList.addEventListener("click", handleRateAction);
    dom.advanceForm.addEventListener("submit", saveAdvance);
    dom.cancelAdvanceEditBtn.addEventListener("click", resetAdvanceForm);
    dom.advancesList.addEventListener("click", handleAdvanceAction);
    dom.bulkPaymentForm.addEventListener("submit", confirmBulkPayment);
    dom.saveStatus.addEventListener("click", initializeCloudSync);
    dom.advanceFilterEmployees.addEventListener("change", handleAdvanceEmployeeFilter);
    dom.advanceEmployee.addEventListener("change", syncAdvanceEmployeeSelection);
    dom.advanceFilterStart.addEventListener("change", renderAdvances);
    dom.advanceFilterEnd.addEventListener("change", renderAdvances);
    $("#clearAdvanceFiltersBtn").addEventListener("click", clearAdvanceFilters);
    [dom.filterEmployee, dom.filterStart, dom.filterEnd, dom.filterStatus].forEach((input) => input.addEventListener("change", () => { activePeriod = "custom"; updateActiveChips(); renderDashboard(); }));
    dom.recordsList.addEventListener("click", handleRecordAction);
    dom.employeesList.addEventListener("click", handleEmployeeAction);
    window.addEventListener("online", initializeCloudSync);
    window.addEventListener("offline", () => setSaveStatus("offline", "Sem internet • salvo neste aparelho"));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) initializeCloudSync(); });
  }

  function openEmployees() {
    resetEmployeeForm();
    renderEmployees();
    dom.employeesDialog.showModal();
    setTimeout(() => dom.employeeName.focus(), 50);
  }

  function getEmployee(id) { return state.employees.find((employee) => employee.id === id); }

  function saveEmployee(event) {
    event.preventDefault();
    hideError(dom.employeeError);
    const name = dom.employeeName.value.trim();
    const paymentType = dom.employeePaymentType.value === "monthly" ? "monthly" : "daily";
    const rate = Number(dom.employeeRate.value);
    const monthlySalary = Number(dom.employeeMonthlySalary.value);
    const monthlyHours = Number(dom.employeeMonthlyHours.value);
    const editing = Boolean(dom.employeeId.value);
    if (!name) return showError(dom.employeeError, "Informe o nome do colaborador.");
    if (paymentType === "daily" && (!Number.isFinite(rate) || rate <= 0)) return showError(dom.employeeError, "Informe uma diária válida.");
    if (paymentType === "monthly" && (!Number.isFinite(monthlySalary) || monthlySalary <= 0)) return showError(dom.employeeError, "Informe um salário mensal válido.");
    if (paymentType === "monthly" && (!Number.isFinite(monthlyHours) || monthlyHours <= 0)) return showError(dom.employeeError, "Informe as horas mensais para o cálculo.");
    const duplicate = state.employees.find((employee) => employee.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR") && employee.id !== dom.employeeId.value);
    if (duplicate) return showError(dom.employeeError, "Já existe um colaborador com este nome.");

    if (editing) {
      const employee = getEmployee(dom.employeeId.value);
      if (employee) {
        if (paymentType === "daily") {
          const dailyRate = L.roundMoney(rate);
          if (!employee.rateHistory.length) employee.rateHistory.push({ id: uid(), startDate: "0000-01-01", dailyRate });
          else employee.rateHistory.at(-1).dailyRate = dailyRate;
          employee.dailyRate = dailyRate;
        }
        Object.assign(employee, {
          name,
          paymentType,
          monthlySalary: paymentType === "monthly" ? L.roundMoney(monthlySalary) : Number(employee.monthlySalary) || 0,
          monthlyHours: paymentType === "monthly" ? monthlyHours : Number(employee.monthlyHours) || 220,
          updatedAt: new Date().toISOString()
        });
      }
      toast("Colaborador atualizado.");
    } else {
      const dailyRate = paymentType === "daily" ? L.roundMoney(rate) : 0;
      const employee = {
        id: uid(),
        name,
        paymentType,
        dailyRate,
        rateHistory: paymentType === "daily" ? [{ id: uid(), startDate: "0000-01-01", dailyRate }] : [],
        monthlySalary: paymentType === "monthly" ? L.roundMoney(monthlySalary) : 0,
        monthlyHours: paymentType === "monthly" ? monthlyHours : 220,
        createdAt: new Date().toISOString()
      };
      state.employees.push(employee);
      dom.employeeSelect.value = employee.id;
      toast("Colaborador adicionado.");
    }
    saveState();
    resetEmployeeForm();
    renderAll();
    updatePreview();
  }

  function handleEmployeeAction(event) {
    const button = event.target.closest("button[data-employee-action]");
    if (!button) return;
    const employee = getEmployee(button.dataset.id);
    if (!employee) return;
    if (button.dataset.employeeAction === "rates") {
      if (employee.paymentType === "monthly") return toast("Mensalista usa salário mensal e horas do mês.");
      dom.employeesDialog.close();
      openRates(employee.id);
      return;
    }
    if (button.dataset.employeeAction === "edit") {
      dom.employeeId.value = employee.id;
      dom.employeeName.value = employee.name;
      dom.employeePaymentType.value = employee.paymentType === "monthly" ? "monthly" : "daily";
      dom.employeeRate.value = employee.dailyRate ? Number(employee.dailyRate).toFixed(2) : "";
      dom.employeeMonthlySalary.value = employee.monthlySalary ? Number(employee.monthlySalary).toFixed(2) : "";
      dom.employeeMonthlyHours.value = Number(employee.monthlyHours) || 220;
      updateEmployeePaymentFields();
      dom.saveEmployeeBtn.textContent = "Salvar alterações";
      dom.cancelEmployeeEditBtn.hidden = false;
      dom.employeeName.focus();
      return;
    }
    const linked = state.entries.filter((entry) => entry.employeeId === employee.id).length;
    const linkedAdvances = state.advances.filter((advance) => advance.employeeId === employee.id).length;
    const message = linked || linkedAdvances
      ? `Excluir ${employee.name}, ${linked} registro(s) de jornada/falta e ${linkedAdvances} vale(s)? Esta ação não pode ser desfeita.`
      : `Excluir o colaborador ${employee.name}?`;
    if (!confirm(message)) return;
    state.employees = state.employees.filter((item) => item.id !== employee.id);
    state.entries = state.entries.filter((entry) => entry.employeeId !== employee.id);
    state.advances = state.advances.filter((advance) => advance.employeeId !== employee.id);
    saveState();
    resetEmployeeForm();
    renderAll();
    updatePreview();
    toast("Colaborador excluído.");
  }

  function resetEmployeeForm() {
    dom.employeeForm.reset();
    dom.employeeId.value = "";
    dom.employeePaymentType.value = "daily";
    dom.employeeMonthlyHours.value = "220";
    updateEmployeePaymentFields();
    dom.saveEmployeeBtn.textContent = "Adicionar";
    dom.cancelEmployeeEditBtn.hidden = true;
    hideError(dom.employeeError);
  }

  function updateEmployeePaymentFields() {
    const isMonthly = dom.employeePaymentType.value === "monthly";
    dom.employeeRateField.hidden = isMonthly;
    dom.employeeRate.disabled = isMonthly;
    dom.employeeRate.required = !isMonthly;
    dom.employeeMonthlyFields.hidden = !isMonthly;
    dom.employeeMonthlySalary.disabled = !isMonthly;
    dom.employeeMonthlySalary.required = isMonthly;
    dom.employeeMonthlyHours.disabled = !isMonthly;
    dom.employeeMonthlyHours.required = isMonthly;
    if (isMonthly && !dom.employeeMonthlyHours.value) dom.employeeMonthlyHours.value = "220";
  }

  function getRateHistory(employee) {
    return [...(employee?.rateHistory || [])].sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  function resolveEmployeeRate(employeeOrId, date = todayISO(), fallback = 0) {
    const employee = typeof employeeOrId === "string" ? getEmployee(employeeOrId) : employeeOrId;
    if (!employee) return Number(fallback) || 0;
    return L.resolveRateHistory(employee.rateHistory, date, employee.dailyRate ?? fallback);
  }

  function currentPaymentConfig(employee, date = todayISO()) {
    const paymentType = employee?.paymentType === "monthly" ? "monthly" : "daily";
    return paymentType === "monthly"
      ? {
          paymentType,
          dailyRate: 0,
          monthlySalary: Number(employee?.monthlySalary) || 0,
          monthlyHours: Number(employee?.monthlyHours) || 220
        }
      : {
          paymentType,
          dailyRate: resolveEmployeeRate(employee, date, employee?.dailyRate),
          monthlySalary: 0,
          monthlyHours: 220
        };
  }

  function entryPaymentConfig(entry) {
    const paymentType = entry.paymentTypeSnapshot === "monthly" ? "monthly" : "daily";
    if (paymentType === "monthly") {
      return {
        paymentType,
        dailyRate: 0,
        monthlySalary: Number(entry.monthlySalarySnapshot) || 0,
        monthlyHours: Number(entry.monthlyHoursSnapshot) || 220
      };
    }
    return {
      paymentType,
      dailyRate: resolveEmployeeRate(entry.employeeId, entry.date, entry.dailyRateSnapshot),
      monthlySalary: 0,
      monthlyHours: 220
    };
  }

  function paymentBaseLabel(config) {
    return config.paymentType === "monthly"
      ? `Mensal ${currency.format(config.monthlySalary)} • ${config.monthlyHours}h/mês`
      : `Diária ${currency.format(config.dailyRate)}`;
  }

  function paymentStatusText(summary) {
    if (summary.status === "paid") return summary.latestPaidDate ? `Pago • última data ${dateBR(summary.latestPaidDate)}` : "Pago";
    if (summary.status === "partial") return summary.latestPaidDate
      ? `Parcial • último em ${dateBR(summary.latestPaidDate)}`
      : "Pagamento parcial";
    return "Não pago";
  }

  function openRates(employeeId) {
    const employee = getEmployee(employeeId);
    if (!employee) return;
    activeRateEmployeeId = employeeId;
    dom.ratesEmployeeName.textContent = employee.name;
    resetRateForm();
    renderRates();
    dom.ratesDialog.showModal();
  }

  function saveRate(event) {
    event.preventDefault();
    hideError(dom.rateError);
    const employee = getEmployee(activeRateEmployeeId);
    if (!employee) return showError(dom.rateError, "Colaborador não encontrado.");
    const existing = employee.rateHistory.find((rate) => rate.id === dom.rateId.value);
    const startDate = existing?.startDate === "0000-01-01" ? "0000-01-01" : dom.rateStartDate.value;
    const dailyRate = Number(dom.rateValue.value);
    if (!startDate || !Number.isFinite(dailyRate) || dailyRate <= 0) return showError(dom.rateError, "Informe a data inicial e o valor da diária.");
    const duplicate = employee.rateHistory.find((rate) => rate.startDate === startDate && rate.id !== dom.rateId.value);
    if (duplicate) return showError(dom.rateError, "Já existe uma diária começando nesta data.");
    if (existing) Object.assign(existing, { startDate, dailyRate: L.roundMoney(dailyRate) });
    else employee.rateHistory.push({ id: uid(), startDate, dailyRate: L.roundMoney(dailyRate) });
    employee.rateHistory.sort((a, b) => a.startDate.localeCompare(b.startDate));
    employee.dailyRate = employee.rateHistory.at(-1).dailyRate;
    employee.updatedAt = new Date().toISOString();
    saveState();
    resetRateForm();
    renderRates();
    renderAll();
    updatePreview();
    toast(existing ? "Diária atualizada e jornadas recalculadas." : "Nova diária adicionada e jornadas recalculadas.");
  }

  function handleRateAction(event) {
    const button = event.target.closest("button[data-rate-action]");
    if (!button) return;
    const employee = getEmployee(activeRateEmployeeId);
    const rate = employee?.rateHistory.find((item) => item.id === button.dataset.id);
    if (!employee || !rate) return;
    if (button.dataset.rateAction === "edit") {
      dom.rateId.value = rate.id;
      dom.rateStartDate.value = rate.startDate === "0000-01-01" ? "" : rate.startDate;
      dom.rateStartDate.disabled = rate.startDate === "0000-01-01";
      dom.rateStartDate.required = rate.startDate !== "0000-01-01";
      dom.rateValue.value = rate.dailyRate.toFixed(2);
      dom.saveRateBtn.textContent = "Salvar alteração";
      dom.cancelRateEditBtn.hidden = false;
      dom.rateValue.focus();
      return;
    }
    if (employee.rateHistory.length === 1) return toast("O colaborador precisa ter pelo menos uma diária.");
    if (!confirm(`Excluir a diária de ${currency.format(rate.dailyRate)}? As jornadas serão recalculadas.`)) return;
    employee.rateHistory = employee.rateHistory.filter((item) => item.id !== rate.id);
    employee.dailyRate = employee.rateHistory.at(-1).dailyRate;
    saveState();
    resetRateForm();
    renderRates();
    renderAll();
    updatePreview();
    toast("Diária excluída e jornadas recalculadas.");
  }

  function resetRateForm() {
    dom.rateForm.reset();
    dom.rateId.value = "";
    dom.rateStartDate.value = todayISO();
    dom.rateStartDate.disabled = false;
    dom.rateStartDate.required = true;
    dom.saveRateBtn.textContent = "Adicionar alteração";
    dom.cancelRateEditBtn.hidden = true;
    hideError(dom.rateError);
  }

  function renderRates() {
    const employee = getEmployee(activeRateEmployeeId);
    if (!employee) return;
    const history = getRateHistory(employee);
    const todayRateItem = history.filter((rate) => rate.startDate <= todayISO()).at(-1) || history[0];
    dom.ratesList.innerHTML = history.map((rate, index) => {
      const next = history[index + 1];
      const until = next ? dayBefore(next.startDate) : null;
      const period = rate.startDate === "0000-01-01"
        ? `Desde o início${until ? ` até ${dateBR(until)}` : ""}`
        : `${index === history.length - 1 ? "A partir de" : "De"} ${dateBR(rate.startDate)}${until ? ` até ${dateBR(until)}` : ""}`;
      const current = rate.id === todayRateItem?.id;
      return `<div class="rate-item"><div class="rate-period"><strong>${currency.format(rate.dailyRate)}${current ? '<span class="rate-current">vigente hoje</span>' : ""}</strong><small>${period}</small></div><div class="rate-actions"><button class="mini-btn" data-rate-action="edit" data-id="${rate.id}" type="button">Editar</button><button class="mini-btn delete" data-rate-action="delete" data-id="${rate.id}" type="button">Excluir</button></div></div>`;
    }).join("");
  }

  function dayBefore(iso) {
    const [year, month, day] = iso.split("-").map(Number);
    const date = new Date(year, month - 1, day - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function openAdvances() {
    renderEmployeeSelects();
    resetAdvanceForm();
    renderAdvances();
    dom.advancesDialog.showModal();
  }

  function saveAdvance(event) {
    event.preventDefault();
    hideError(dom.advanceError);
    const employee = getEmployee(dom.advanceEmployee.value);
    const value = L.parseMoneyInput(dom.advanceValue.value);
    if (!employee || !dom.advanceDate.value || !Number.isFinite(value) || value <= 0) {
      return showError(dom.advanceError, "Informe o colaborador, a data e um valor válido.");
    }
    const payload = {
      employeeId: employee.id,
      employeeNameSnapshot: employee.name,
      date: dom.advanceDate.value,
      value: L.roundMoney(value),
      note: dom.advanceNote.value.trim(),
      updatedAt: new Date().toISOString()
    };
    const existing = state.advances.find((advance) => advance.id === dom.advanceId.value);
    if (existing) Object.assign(existing, payload);
    else state.advances.push({ id: uid(), ...payload, createdAt: new Date().toISOString() });
    saveState();
    resetAdvanceForm();
    renderAdvances();
    renderDashboard();
    toast(existing ? "Vale atualizado." : "Vale adicionado e descontado do período.");
  }

  function handleAdvanceAction(event) {
    const button = event.target.closest("button[data-advance-action]");
    if (!button) return;
    const advance = state.advances.find((item) => item.id === button.dataset.id);
    if (!advance) return;
    if (button.dataset.advanceAction === "edit") {
      dom.advanceId.value = advance.id;
      dom.advanceEmployee.value = advance.employeeId;
      dom.advanceFilterEmployee.value = advance.employeeId;
      dom.advanceDate.value = advance.date;
      dom.advanceValue.value = Number(advance.value).toFixed(2);
      dom.advanceNote.value = advance.note || "";
      dom.saveAdvanceBtn.textContent = "Salvar vale";
      dom.cancelAdvanceEditBtn.hidden = false;
      renderAdvances();
      return;
    }
    if (!confirm(`Excluir o vale de ${currency.format(advance.value)} de ${dateBR(advance.date)}?`)) return;
    state.advances = state.advances.filter((item) => item.id !== advance.id);
    saveState();
    resetAdvanceForm();
    renderAdvances();
    renderDashboard();
    toast("Vale excluído.");
  }

  function resetAdvanceForm() {
    dom.advanceForm.reset();
    dom.advanceId.value = "";
    dom.advanceDate.value = todayISO();
    const selectedEmployee = dom.advanceFilterEmployee.value;
    if (selectedEmployee !== "all" && getEmployee(selectedEmployee)) dom.advanceEmployee.value = selectedEmployee;
    dom.saveAdvanceBtn.textContent = "Adicionar vale";
    dom.cancelAdvanceEditBtn.hidden = true;
    hideError(dom.advanceError);
  }

  function clearAdvanceFilters() {
    dom.advanceFilterEmployee.value = "all";
    dom.advanceFilterStart.value = "";
    dom.advanceFilterEnd.value = "";
    renderAdvances();
  }

  function handleAdvanceEmployeeFilter(event) {
    const input = event.target.closest('input[name="advanceEmployeeView"]');
    if (!input) return;
    dom.advanceFilterEmployee.value = input.value;
    if (input.value !== "all") dom.advanceEmployee.value = input.value;
    renderAdvances();
  }

  function syncAdvanceEmployeeSelection() {
    if (!dom.advanceEmployee.value) return;
    dom.advanceFilterEmployee.value = dom.advanceEmployee.value;
    renderAdvances();
  }

  function updateAdvanceEmployeeFilterButtons() {
    const selectedEmployee = dom.advanceFilterEmployee.value || "all";
    dom.advanceFilterEmployees.querySelectorAll('input[name="advanceEmployeeView"]').forEach((input) => {
      const active = input.value === selectedEmployee;
      input.checked = active;
      input.closest("label")?.classList.toggle("active", active);
    });
    dom.advanceFilterSelection.textContent = selectedEmployee === "all"
      ? "Todos os colaboradores"
      : getEmployee(selectedEmployee)?.name || "Colaborador selecionado";
  }

  function renderAdvances() {
    const selectedEmployee = dom.advanceFilterEmployee.value || "all";
    const startDate = dom.advanceFilterStart.value;
    const endDate = dom.advanceFilterEnd.value;
    const invalidPeriod = Boolean(startDate && endDate && startDate > endDate);
    const advances = invalidPeriod ? [] : state.advances
      .filter((advance) => selectedEmployee === "all" || advance.employeeId === selectedEmployee)
      .filter((advance) => !startDate || advance.date >= startDate)
      .filter((advance) => !endDate || advance.date <= endDate)
      .sort((a, b) => b.date.localeCompare(a.date));
    const total = advances.reduce((sum, advance) => sum + Number(advance.value), 0);
    updateAdvanceEmployeeFilterButtons();
    dom.advanceFilterStart.setAttribute("aria-invalid", String(invalidPeriod));
    dom.advanceFilterEnd.setAttribute("aria-invalid", String(invalidPeriod));
    dom.advanceFilterPeriod.textContent = startDate && endDate
      ? `${dateBR(startDate)} até ${dateBR(endDate)}`
      : startDate ? `A partir de ${dateBR(startDate)}`
        : endDate ? `Até ${dateBR(endDate)}` : "Todos os períodos";
    dom.advanceFilterCount.textContent = invalidPeriod
      ? "Revise as datas do período"
      : `${advances.length} ${advances.length === 1 ? "vale encontrado" : "vales encontrados"}`;
    dom.advanceFilterTotal.textContent = currency.format(total);
    dom.advancesList.innerHTML = invalidPeriod
      ? '<div class="advance-empty">A data inicial precisa ser anterior à data final.</div>'
      : advances.length ? advances.map((advance) => `<div class="advance-item">
      <div class="advance-info"><strong>${escapeHTML(displayEmployeeName(advance.employeeId, advance))} • ${dateBR(advance.date)}</strong><small>${escapeHTML(advance.note || "Vale/adiantamento")}</small></div>
      <div class="advance-amount">− ${currency.format(advance.value)}</div>
      <div class="advance-actions"><button class="mini-btn" data-advance-action="edit" data-id="${advance.id}" type="button">Editar</button><button class="mini-btn delete" data-advance-action="delete" data-id="${advance.id}" type="button">Excluir</button></div>
    </div>`).join("") : '<div class="advance-empty">Nenhum vale encontrado com estes filtros.</div>';
  }

  function saveEntry(event) {
    event.preventDefault();
    hideError(dom.formError);
    const employee = getEmployee(dom.employeeSelect.value);
    if (!employee) return showError(dom.formError, "Cadastre ou selecione um colaborador.");
    if (!dom.workDate.value) return showError(dom.formError, "Informe a data do registro.");
    const recordType = dom.recordType.value === "absence" ? "absence" : "work";
    const isAbsence = recordType === "absence";
    const config = currentPaymentConfig(employee, dom.workDate.value);
    const calculation = isAbsence ? { valid: true, ...config, manualValue: null } : currentCalculation(employee);
    if (!calculation.valid) return showError(dom.formError, calculation.error);
    if (!isAbsence && calculation.manualValue !== null && !dom.manualReason.value.trim()) {
      return showError(dom.formError, "Informe o motivo do valor manual.");
    }
    const status = !isAbsence && dom.paymentStatus.value === "paid" ? "paid" : "pending";
    if (!isAbsence && status === "paid" && !dom.paymentDate.value) {
      return showError(dom.formError, "Informe a data em que o pagamento foi feito.");
    }

    const existing = state.entries.find((entry) => entry.id === dom.entryId.value);
    const duplicate = state.entries.find((entry) => entry.employeeId === employee.id && entry.date === dom.workDate.value && entry.id !== dom.entryId.value);
    if (duplicate && !confirm(`${employee.name} já possui ${L.isAbsence(duplicate) ? "uma falta" : "uma jornada"} em ${dateBR(dom.workDate.value)}. Deseja salvar outro registro mesmo assim?`)) return;

    const payload = {
      employeeId: employee.id,
      employeeNameSnapshot: employee.name,
      recordType,
      paymentTypeSnapshot: calculation.paymentType,
      dailyRateSnapshot: calculation.dailyRate,
      monthlySalarySnapshot: calculation.monthlySalary,
      monthlyHoursSnapshot: calculation.monthlyHours,
      date: dom.workDate.value,
      start: isAbsence ? "" : dom.startTime.value,
      breakStart: isAbsence ? "" : dom.breakStart.value,
      breakEnd: isAbsence ? "" : dom.breakEnd.value,
      end: isAbsence ? "" : dom.endTime.value,
      valueMode: isAbsence ? "worked" : dom.valueMode.value,
      manualValue: isAbsence ? null : calculation.manualValue,
      manualReason: isAbsence ? "" : dom.manualReason.value.trim(),
      notes: dom.notes.value.trim(),
      status,
      paidDate: !isAbsence && status === "paid" ? dom.paymentDate.value : "",
      updatedAt: new Date().toISOString()
    };
    if (existing) Object.assign(existing, payload);
    else state.entries.push({ id: uid(), ...payload, createdAt: new Date().toISOString() });
    saveState();
    const wasEditing = Boolean(existing);
    resetEntryForm();
    renderAll();
    toast(wasEditing ? "Registro atualizado." : isAbsence ? "Falta registrada com sucesso." : "Jornada salva com sucesso.");
  }

  function currentCalculation(employee = getEmployee(dom.employeeSelect.value)) {
    const config = currentPaymentConfig(employee, dom.workDate.value || todayISO());
    const result = L.calculateJourney({
      start: dom.startTime.value,
      breakStart: dom.breakStart.value,
      breakEnd: dom.breakEnd.value,
      end: dom.endTime.value,
      ...config,
      manualValue: dom.manualValue.value,
      valueMode: dom.valueMode.value
    });
    return { ...result, ...config };
  }

  function calculateEntry(entry) {
    const config = entryPaymentConfig(entry);
    if (L.isAbsence(entry)) {
      return { valid: true, isAbsence: true, workedMinutes: 0, balanceMinutes: 0, calculatedValue: 0, finalValue: 0, manualValue: null, adjustment: 0, hourlyRate: 0, ...config };
    }
    return { ...L.calculateJourney({ ...entry, ...config, manualValue: entry.manualValue, valueMode: entry.valueMode || "worked" }), ...config };
  }

  function updatePreview() {
    const employee = getEmployee(dom.employeeSelect.value);
    if (dom.recordType.value === "absence") {
      dom.rateHint.textContent = employee
        ? `Falta de ${employee.name}: sem horas e sem valor calculado.`
        : "Selecione o colaborador para registrar a falta.";
      return;
    }
    const config = currentPaymentConfig(employee, dom.workDate.value || todayISO());
    const hourlyRate = config.paymentType === "monthly"
      ? config.monthlySalary / config.monthlyHours
      : config.dailyRate / 8;
    dom.rateHint.textContent = employee
      ? config.paymentType === "monthly"
        ? `Mensalista: ${currency.format(config.monthlySalary)} ÷ ${config.monthlyHours}h = ${currency.format(hourlyRate)} por hora`
        : `Diária em ${dateBR(dom.workDate.value || todayISO())}: ${currency.format(config.dailyRate)} • Hora: ${currency.format(hourlyRate)}`
      : "A forma de pagamento será guardada neste lançamento.";
    const result = currentCalculation(employee);
    if (!result.valid) {
      dom.previewHours.textContent = "—";
      dom.previewCalculated.textContent = "—";
      dom.previewFinal.textContent = "—";
      dom.previewFinal.classList.remove("negative-text");
      return;
    }
    dom.previewHours.textContent = dom.valueMode.value === "balance8h"
      ? `${L.formatDuration(result.workedMinutes)} (saldo ${L.formatSignedDuration(result.balanceMinutes)})`
      : L.formatDuration(result.workedMinutes);
    dom.previewCalculated.textContent = currency.format(result.calculatedValue);
    dom.previewFinal.textContent = currency.format(result.finalValue);
    dom.previewFinal.classList.toggle("negative-text", result.finalValue < 0);
    dom.formulaNote.textContent = dom.valueMode.value === "balance8h"
      ? `${L.formatDuration(result.workedMinutes)} − 8h = ${L.formatSignedDuration(result.balanceMinutes)}. Saldo: ${currency.format(result.calculatedValue)}${result.manualValue !== null ? " • substituído pelo valor manual" : ""}.`
      : result.paymentType === "monthly"
        ? `${currency.format(result.monthlySalary)} ÷ ${result.monthlyHours}h × ${(result.workedMinutes / 60).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}h = ${currency.format(result.calculatedValue)}${result.manualValue !== null ? " • substituído pelo valor manual" : ""}.`
        : `${currency.format(result.dailyRate)} ÷ 8 × ${(result.workedMinutes / 60).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}h = ${currency.format(result.calculatedValue)}${result.manualValue !== null ? " • substituído pelo valor manual" : ""}.`;
  }

  function updatePaymentDateField() {
    const isPaid = dom.recordType.value !== "absence" && dom.paymentStatus.value === "paid";
    dom.paymentDateField.hidden = !isPaid;
    dom.paymentDate.disabled = !isPaid;
    dom.paymentDate.required = isPaid;
    if (isPaid && !dom.paymentDate.value) dom.paymentDate.value = todayISO();
  }

  function updateRecordTypeFields() {
    const isAbsence = dom.recordType.value === "absence";
    dom.timeGrid.hidden = isAbsence;
    dom.calculationMode.hidden = isAbsence;
    dom.calcPreview.hidden = isAbsence;
    dom.formulaNote.hidden = isAbsence;
    dom.adjustmentBox.hidden = isAbsence;
    dom.paymentStatusField.hidden = isAbsence;
    dom.absenceFormNotice.hidden = !isAbsence;
    [dom.startTime, dom.breakStart, dom.breakEnd, dom.endTime, dom.valueMode, dom.manualValue, dom.manualReason, dom.paymentStatus].forEach((input) => { input.disabled = isAbsence; });
    dom.startTime.required = !isAbsence;
    dom.endTime.required = !isAbsence;
    dom.entryFormTitle.textContent = isAbsence ? "Registrar falta" : "Registrar jornada";
    dom.notesLabel.innerHTML = isAbsence ? "Motivo ou observação <span>(opcional)</span>" : "Observação <span>(opcional)</span>";
    dom.notes.placeholder = isAbsence ? "Ex.: não compareceu e não justificou" : "Serviço, local ou lembrete";
    if (!dom.entryId.value) dom.saveEntryBtn.textContent = isAbsence ? "Registrar falta" : "Salvar jornada";
    updatePaymentDateField();
    updatePreview();
  }

  function resetEntryForm() {
    dom.entryForm.reset();
    dom.entryId.value = "";
    dom.workDate.value = todayISO();
    dom.recordType.value = "work";
    dom.valueMode.value = "worked";
    dom.paymentStatus.value = "pending";
    dom.paymentDate.value = todayISO();
    updateRecordTypeFields();
    dom.formMode.textContent = "NOVO LANÇAMENTO";
    dom.saveEntryBtn.textContent = "Salvar jornada";
    dom.cancelEditBtn.hidden = true;
    dom.adjustmentBox.open = false;
    hideError(dom.formError);
    renderEmployeeSelects();
    updatePreview();
  }

  function handleRecordAction(event) {
    const groupButton = event.target.closest("button[data-group-action]");
    if (groupButton) {
      handleGroupPaymentAction(groupButton);
      return;
    }
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const entry = state.entries.find((item) => item.id === button.dataset.id);
    if (!entry) return;
    if (button.dataset.action === "toggle") {
      if (L.isAbsence(entry)) return;
      if (entry.status !== "paid") {
        openPaymentConfirmation([entry], entry.employeeId);
        return;
      }
      entry.status = "pending";
      entry.paidDate = "";
      entry.updatedAt = new Date().toISOString();
      saveState();
      renderDashboard();
      toast("Marcado como não pago.");
      return;
    }
    if (button.dataset.action === "delete") {
      if (!confirm(`Excluir ${L.isAbsence(entry) ? "a falta" : "a jornada"} de ${dateBR(entry.date)}?`)) return;
      state.entries = state.entries.filter((item) => item.id !== entry.id);
      saveState();
      renderDashboard();
      toast("Lançamento excluído.");
      return;
    }
    if (button.dataset.action === "edit") editEntry(entry);
  }

  function visibleEmployeeEntries(employeeId) {
    return getFilteredEntries().filter((entry) => entry.employeeId === employeeId && !L.isAbsence(entry));
  }

  function openPaymentConfirmation(entries, employeeId) {
    if (!entries.length) return toast("Não há jornadas não pagas neste período.");
    const employee = getEmployee(employeeId);
    const total = entries.reduce((sum, entry) => {
      const calculation = calculateEntry(entry);
      return sum + (calculation.valid ? calculation.finalValue : 0);
    }, 0);
    activeBulkPaymentEntryIds = entries.map((entry) => entry.id);
    dom.bulkPaymentEmployeeName.textContent = employee?.name || entries[0]?.employeeNameSnapshot || "Colaborador";
    dom.bulkPaymentSummary.textContent = `${entries.length} ${entries.length === 1 ? "jornada não paga" : "jornadas não pagas"} • ${currency.format(total)}`;
    dom.bulkPaymentDate.value = todayISO();
    hideError(dom.bulkPaymentError);
    dom.bulkPaymentDialog.showModal();
    setTimeout(() => dom.bulkPaymentDate.focus(), 50);
  }

  function handleGroupPaymentAction(button) {
    const employeeId = button.dataset.employeeId;
    const entries = visibleEmployeeEntries(employeeId);
    if (button.dataset.groupAction === "pay") {
      const pendingEntries = entries.filter((entry) => entry.status !== "paid");
      if (!pendingEntries.length) return toast("Todas as jornadas deste período já estão pagas.");
      openPaymentConfirmation(pendingEntries, employeeId);
      return;
    }
    if (button.dataset.groupAction === "unpay") {
      const paidEntries = entries.filter((entry) => entry.status === "paid");
      if (!paidEntries.length) return toast("Não há jornadas pagas neste período.");
      const name = getEmployee(employeeId)?.name || paidEntries[0]?.employeeNameSnapshot || "este colaborador";
      if (!confirm(`Marcar ${paidEntries.length} jornada(s) de ${name} como não paga(s) neste período?`)) return;
      paidEntries.forEach((entry) => {
        entry.status = "pending";
        entry.paidDate = "";
        entry.updatedAt = new Date().toISOString();
      });
      saveState();
      renderDashboard();
      toast("Jornadas marcadas como não pagas.");
    }
  }

  function confirmBulkPayment(event) {
    event.preventDefault();
    hideError(dom.bulkPaymentError);
    if (!dom.bulkPaymentDate.value) return showError(dom.bulkPaymentError, "Informe a data do pagamento.");
    const entries = state.entries.filter((entry) => activeBulkPaymentEntryIds.includes(entry.id) && !L.isAbsence(entry));
    if (!entries.length) return showError(dom.bulkPaymentError, "As jornadas não foram encontradas. Feche e tente novamente.");
    entries.forEach((entry) => {
      entry.status = "paid";
      entry.paidDate = dom.bulkPaymentDate.value;
      entry.updatedAt = new Date().toISOString();
    });
    saveState();
    activeBulkPaymentEntryIds = [];
    dom.bulkPaymentDialog.close();
    renderDashboard();
    toast(`${entries.length} jornada(s) paga(s) em ${dateBR(dom.bulkPaymentDate.value)}.`);
  }

  function editEntry(entry) {
    dom.entryId.value = entry.id;
    dom.employeeSelect.value = entry.employeeId;
    dom.workDate.value = entry.date;
    dom.recordType.value = L.isAbsence(entry) ? "absence" : "work";
    dom.startTime.value = entry.start || "";
    dom.breakStart.value = entry.breakStart || "";
    dom.breakEnd.value = entry.breakEnd || "";
    dom.endTime.value = entry.end || "";
    dom.valueMode.value = entry.valueMode || "worked";
    dom.manualValue.value = entry.manualValue ?? "";
    dom.manualReason.value = entry.manualReason || "";
    dom.notes.value = entry.notes || "";
    dom.paymentStatus.value = entry.status;
    dom.paymentDate.value = entry.paidDate || todayISO();
    updateRecordTypeFields();
    dom.adjustmentBox.open = entry.manualValue !== null && entry.manualValue !== undefined;
    dom.formMode.textContent = L.isAbsence(entry) ? "EDITANDO FALTA" : "EDITANDO JORNADA";
    dom.saveEntryBtn.textContent = "Salvar alterações";
    dom.cancelEditBtn.hidden = false;
    updatePreview();
    window.scrollTo({ top: 80, behavior: "smooth" });
  }

  function renderAll() {
    renderEmployeeSelects();
    renderEmployees();
    renderDashboard();
    updateBackupMeta();
  }

  function renderEmployeeSelects() {
    const currentEntry = dom.employeeSelect.value;
    const currentFilter = dom.filterEmployee.value;
    const currentAdvance = dom.advanceEmployee.value;
    const currentAdvanceFilter = dom.advanceFilterEmployee.value;
    const options = [...state.employees].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    dom.employeeSelect.innerHTML = options.length
      ? '<option value="">Selecione</option>' + options.map((employee) => `<option value="${employee.id}">${escapeHTML(employee.name)} — ${escapeHTML(paymentBaseLabel(currentPaymentConfig(employee, dom.workDate.value || todayISO())))}</option>`).join("")
      : '<option value="">Cadastre um colaborador</option>';
    dom.filterEmployee.innerHTML = '<option value="all">Todos</option>' + options.map((employee) => `<option value="${employee.id}">${escapeHTML(employee.name)}</option>`).join("");
    dom.advanceEmployee.innerHTML = '<option value="">Selecione</option>' + options.map((employee) => `<option value="${employee.id}">${escapeHTML(employee.name)}</option>`).join("");
    if (options.some((employee) => employee.id === currentEntry)) dom.employeeSelect.value = currentEntry;
    if (options.some((employee) => employee.id === currentFilter)) dom.filterEmployee.value = currentFilter;
    if (options.some((employee) => employee.id === currentAdvance)) dom.advanceEmployee.value = currentAdvance;
    dom.advanceFilterEmployee.value = options.some((employee) => employee.id === currentAdvanceFilter) ? currentAdvanceFilter : "all";
    dom.advanceFilterEmployees.innerHTML = `<label class="advance-employee-option"><input type="radio" name="advanceEmployeeView" value="all"><span class="advance-radio-mark" aria-hidden="true"></span><span>Todos os colaboradores</span></label>${options.map((employee) => `<label class="advance-employee-option"><input type="radio" name="advanceEmployeeView" value="${escapeHTML(employee.id)}"><span class="advance-radio-mark" aria-hidden="true"></span><span>${escapeHTML(employee.name)}</span></label>`).join("")}`;
    updateAdvanceEmployeeFilterButtons();
  }

  function renderEmployees() {
    const employees = [...state.employees].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    dom.employeesList.innerHTML = employees.length ? employees.map((employee) => {
      const employeeEntries = state.entries.filter((entry) => entry.employeeId === employee.id);
      const absenceCount = employeeEntries.filter(L.isAbsence).length;
      const journeyCount = employeeEntries.length - absenceCount;
      const config = currentPaymentConfig(employee, todayISO());
      const summary = config.paymentType === "monthly"
        ? `Mensalista • ${currency.format(config.monthlySalary)} • ${config.monthlyHours}h/mês`
        : `${currency.format(config.dailyRate)} vigente • ${employee.rateHistory.length} diária(s) no histórico`;
      return `<div class="employee-item">
        <div class="employee-info"><strong>${escapeHTML(employee.name)}</strong><small>${summary} • ${journeyCount} jornada(s) • ${absenceCount} falta(s)</small></div>
        <div class="employee-actions">
          ${config.paymentType === "daily" ? `<button class="mini-btn rate" data-employee-action="rates" data-id="${employee.id}" type="button">Diárias</button>` : ""}
          <button class="mini-btn" data-employee-action="edit" data-id="${employee.id}" type="button">Editar</button>
          <button class="mini-btn delete" data-employee-action="delete" data-id="${employee.id}" type="button">Excluir</button>
        </div>
      </div>`;
    }).join("") : '<div class="empty-mini">Nenhum colaborador cadastrado ainda.</div>';
  }

  function getFilteredEntries(employeeFilter = dom.filterEmployee.value) {
    return state.entries.filter((entry) => {
      if (employeeFilter !== "all" && entry.employeeId !== employeeFilter) return false;
      if (dom.filterStatus.value === "absence" && !L.isAbsence(entry)) return false;
      if (["paid", "pending"].includes(dom.filterStatus.value) && (L.isAbsence(entry) || entry.status !== dom.filterStatus.value)) return false;
      if (dom.filterStart.value && entry.date < dom.filterStart.value) return false;
      if (dom.filterEnd.value && entry.date > dom.filterEnd.value) return false;
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date) || (a.employeeNameSnapshot || "").localeCompare(b.employeeNameSnapshot || "", "pt-BR"));
  }

  function getFilteredAdvances(employeeFilter = dom.filterEmployee.value) {
    if (dom.filterStatus.value === "absence") return [];
    return state.advances.filter((advance) => {
      if (employeeFilter !== "all" && advance.employeeId !== employeeFilter) return false;
      if (dom.filterStart.value && advance.date < dom.filterStart.value) return false;
      if (dom.filterEnd.value && advance.date > dom.filterEnd.value) return false;
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }

  function renderDashboard() {
    const entries = getFilteredEntries();
    const advances = getFilteredAdvances();
    const absences = entries.filter(L.isAbsence);
    const workEntries = entries.filter((entry) => !L.isAbsence(entry));
    const computed = workEntries.map((entry) => ({ entry, calculation: calculateEntry(entry) })).filter((item) => item.calculation.valid);
    const totalMinutes = computed.reduce((sum, item) => sum + item.calculation.workedMinutes, 0);
    const grossValue = computed.reduce((sum, item) => sum + item.calculation.finalValue, 0);
    const advancesValue = advances.reduce((sum, advance) => sum + Number(advance.value), 0);
    const netValue = grossValue - advancesValue;
    const outstanding = L.summarizeOutstanding(computed.map(({ entry, calculation }) => ({
      employeeId: entry.employeeId,
      status: entry.status,
      finalValue: calculation.finalValue
    })), advances);
    const pendingGross = outstanding.pendingGross;
    const pending = outstanding.pendingNet;
    const paid = grossValue - pendingGross;
    dom.statEmployees.textContent = new Set([...entries.map((entry) => entry.employeeId), ...advances.map((advance) => advance.employeeId)]).size;
    dom.statEntries.textContent = `${workEntries.length} jornada(s) • ${absences.length} falta(s) • ${advances.length} vale(s)`;
    dom.statHours.textContent = L.formatDuration(totalMinutes);
    dom.statTotal.textContent = currency.format(netValue);
    dom.statAdvances.textContent = `Bruto: ${currency.format(grossValue)} • Vales: ${currency.format(advancesValue)}`;
    dom.statPending.textContent = currency.format(pending);
    dom.statPaid.textContent = `Jornadas pagas: ${currency.format(paid)}`;
    renderAbsenceAlert(absences);
    updatePeriodLabel();
    dom.emptyState.hidden = entries.length > 0 || advances.length > 0;
    dom.recordsList.hidden = entries.length === 0 && advances.length === 0;
    dom.recordsList.innerHTML = renderGroups(entries, advances);
  }

  function renderAbsenceAlert(absences) {
    dom.absenceAlert.hidden = absences.length === 0;
    if (!absences.length) {
      dom.absenceAlertText.textContent = "";
      return;
    }
    const grouped = new Map();
    absences.forEach((entry) => {
      const name = displayEmployeeName(entry.employeeId, entry);
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name).push(entry.date);
    });
    dom.absenceAlertText.textContent = [...grouped.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
      .map(([name, dates]) => `${name}: ${[...new Set(dates)].sort().map(dateBR).join(", ")}`)
      .join(" • ");
  }

  function renderGroups(entries, advances) {
    const grouped = new Map();
    entries.forEach((entry) => {
      if (!grouped.has(entry.employeeId)) grouped.set(entry.employeeId, { entries: [], advances: [] });
      grouped.get(entry.employeeId).entries.push(entry);
    });
    advances.forEach((advance) => {
      if (!grouped.has(advance.employeeId)) grouped.set(advance.employeeId, { entries: [], advances: [] });
      grouped.get(advance.employeeId).advances.push(advance);
    });
    return [...grouped.entries()].sort((a, b) => displayEmployeeName(a[0], a[1].entries[0] || a[1].advances[0]).localeCompare(displayEmployeeName(b[0], b[1].entries[0] || b[1].advances[0]), "pt-BR")).map(([employeeId, group]) => {
      const items = group.entries;
      const groupAdvances = group.advances;
      const name = displayEmployeeName(employeeId, items[0] || groupAdvances[0]);
      const absenceItems = items.filter(L.isAbsence);
      const workRows = items.filter((entry) => !L.isAbsence(entry)).map((entry) => ({ entry, calc: calculateEntry(entry) })).filter((item) => item.calc.valid);
      const displayRows = items.map((entry) => ({ entry, calc: calculateEntry(entry) })).filter((item) => item.calc.valid);
      const minutes = workRows.reduce((sum, item) => sum + item.calc.workedMinutes, 0);
      const gross = workRows.reduce((sum, item) => sum + item.calc.finalValue, 0);
      const advancesTotal = groupAdvances.reduce((sum, advance) => sum + Number(advance.value), 0);
      const net = gross - advancesTotal;
      const paymentSummary = L.summarizePayments(workRows.map(({ entry }) => entry));
      const paymentActions = workRows.length ? `<div class="group-payment-actions">
        ${paymentSummary.pendingCount ? `<button class="mini-btn payment-action" data-group-action="pay" data-employee-id="${employeeId}" type="button">Finalizar pagamento</button>` : ""}
        ${paymentSummary.paidCount ? `<button class="mini-btn" data-group-action="unpay" data-employee-id="${employeeId}" type="button">Marcar não pago</button>` : ""}
      </div>` : "";
      return `<section class="employee-group">
        <header class="group-header">
          <div class="group-person"><div class="avatar">${escapeHTML(initials(name))}</div><div class="group-person-copy"><div class="group-person-title"><h3>${escapeHTML(name)}</h3>${workRows.length ? `<span class="group-payment-status ${paymentSummary.status}">${paymentStatusText(paymentSummary)}</span>` : ""}${absenceItems.length ? `<span class="group-absence-status">${absenceItems.length} ${absenceItems.length === 1 ? "falta" : "faltas"}</span>` : ""}</div><small>${workRows.length} jornada(s) • ${absenceItems.length} falta(s) • ${groupAdvances.length} vale(s)</small>${paymentActions}</div></div>
          <div class="group-totals"><div><span>Horas</span><strong>${L.formatDuration(minutes)}</strong></div><div><span>Bruto</span><strong>${currency.format(gross)}</strong></div><div><span>Vales</span><strong>− ${currency.format(advancesTotal)}</strong></div><div><span>Líquido</span><strong>${currency.format(net)}</strong></div></div>
        </header>
        ${displayRows.length ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Jornada</th><th>Intervalo</th><th>Horas</th><th>Base de cálculo</th><th>Valor</th><th>Status</th><th>Observação</th><th></th></tr></thead><tbody>${displayRows.map(({ entry, calc }) => renderEntryRow(entry, calc)).join("")}</tbody></table></div>` : ""}
        ${groupAdvances.length ? `<div class="group-advances"><strong>Vales descontados</strong>${groupAdvances.map((advance) => `<span>${dateBR(advance.date)} • ${escapeHTML(advance.note || "Vale/adiantamento")} • <b>− ${currency.format(advance.value)}</b></span>`).join("")}</div>` : ""}
      </section>`;
    }).join("");
  }

  function renderEntryRow(entry, calc) {
    if (L.isAbsence(entry)) {
      return `<tr class="absence-row">
        <td><strong>${dateBR(entry.date)}</strong></td><td><strong>FALTA</strong></td><td>—</td><td>0h00</td><td>Não trabalhou</td><td class="money">${currency.format(0)}</td>
        <td><span class="badge absence">Falta registrada</span></td>
        <td class="notes-cell" title="${escapeHTML(entry.notes)}">${escapeHTML(entry.notes || "Sem justificativa informada")}</td>
        <td><div class="row-actions"><button class="mini-btn" data-action="edit" data-id="${entry.id}" type="button">Editar</button><button class="mini-btn delete" data-action="delete" data-id="${entry.id}" type="button">Excluir</button></div></td>
      </tr>`;
    }
    const interval = entry.breakStart && entry.breakEnd ? `${entry.breakStart}–${entry.breakEnd}` : "Sem intervalo";
    const manual = calc.manualValue !== null ? `<span class="manual-tag" title="${escapeHTML(entry.manualReason)}">Manual: ${escapeHTML(entry.manualReason || "ajuste")}</span>` : "";
    const balance = entry.valueMode === "balance8h" ? `<span class="manual-tag">Saldo de 8h: ${L.formatSignedDuration(calc.balanceMinutes)}</span>` : "";
    return `<tr>
      <td><strong>${dateBR(entry.date)}</strong></td><td>${entry.start}–${entry.end}</td><td>${interval}</td><td>${L.formatDuration(calc.workedMinutes)}</td>
      <td>${escapeHTML(paymentBaseLabel(calc))}<span class="rate-per-hour">${currency.format(calc.hourlyRate)}/h</span></td><td class="money ${calc.finalValue < 0 ? "negative-text" : ""}">${currency.format(calc.finalValue)}${balance}${manual}</td>
      <td><button class="badge ${entry.status}" data-action="toggle" data-id="${entry.id}" type="button">${entry.status === "paid" ? "Pago" : "Não pago"}</button>${entry.status === "paid" ? `<span class="payment-date">${entry.paidDate ? dateBR(entry.paidDate) : "data não informada"}</span>` : ""}</td>
      <td class="notes-cell" title="${escapeHTML(entry.notes)}">${escapeHTML(entry.notes || "—")}</td>
      <td><div class="row-actions"><button class="mini-btn" data-action="edit" data-id="${entry.id}" type="button">Editar</button><button class="mini-btn delete" data-action="delete" data-id="${entry.id}" type="button">Excluir</button></div></td>
    </tr>`;
  }

  function displayEmployeeName(id, entry) { return getEmployee(id)?.name || entry?.employeeNameSnapshot || "Colaborador removido"; }

  function applyQuickPeriod(type) {
    activePeriod = type;
    const period = L.getClosePeriod(type, new Date());
    dom.filterStart.value = period.start;
    dom.filterEnd.value = period.end;
    dom.filterEmployee.value = "all";
    dom.filterStatus.value = "all";
    updateActiveChips();
    renderDashboard();
  }

  function updateActiveChips() { $$("[data-period]").forEach((button) => button.classList.toggle("active", button.dataset.period === activePeriod)); }
  function updatePeriodLabel() {
    const start = dom.filterStart.value;
    const end = dom.filterEnd.value;
    let label = start || end ? `${start ? dateBR(start) : "início"} a ${end ? dateBR(end) : "hoje"}` : "Todos os lançamentos";
    if (dom.filterEmployee.value !== "all") label += ` • ${getEmployee(dom.filterEmployee.value)?.name || "Colaborador"}`;
    if (dom.filterStatus.value !== "all") label += ` • ${dom.filterStatus.value === "paid" ? "Pagos" : dom.filterStatus.value === "absence" ? "Faltas" : "Não pagos"}`;
    dom.periodLabel.textContent = label;
  }

  function openReport() {
    const entries = getFilteredEntries("all");
    const advances = getFilteredAdvances("all");
    const groups = groupForReport(entries, advances);
    const reportEmployees = new Map(state.employees.map((employee) => [employee.id, employee.name]));
    groups.forEach((group) => { if (!reportEmployees.has(group.employeeId)) reportEmployees.set(group.employeeId, group.name); });
    const employeeOptions = [...reportEmployees.entries()]
      .map(([employeeId, name]) => ({ employeeId, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    dom.reportEmployeeSelect.innerHTML = '<option value="">Selecione um colaborador</option>'
      + (employeeOptions.length > 1 ? '<option value="all">Todos — uma folha por colaborador</option>' : "")
      + employeeOptions.map((employee) => `<option value="${escapeHTML(employee.employeeId)}">${escapeHTML(employee.name)}</option>`).join("");
    const mainSelectedEmployee = dom.filterEmployee.value !== "all" ? dom.filterEmployee.value : "";
    dom.reportEmployeeSelect.value = employeeOptions.some((employee) => employee.employeeId === mainSelectedEmployee)
      ? mainSelectedEmployee
      : employeeOptions.length === 1 ? employeeOptions[0].employeeId : "";
    refreshReportPreview();
    dom.reportDialog.showModal();
  }

  function getReportData() {
    const selectedEmployee = dom.reportEmployeeSelect.value;
    if (!selectedEmployee) return { entries: [], advances: [] };
    const entries = getFilteredEntries("all");
    const advances = getFilteredAdvances("all");
    if (selectedEmployee === "all") return { entries, advances };
    return {
      entries: entries.filter((entry) => entry.employeeId === selectedEmployee),
      advances: advances.filter((advance) => advance.employeeId === selectedEmployee)
    };
  }

  function refreshReportPreview() {
    const selectedEmployee = dom.reportEmployeeSelect.value;
    const buttons = [$("#printReportBtn"), $("#copyWhatsappBtn"), $("#exportCsvBtn")];
    if (!selectedEmployee) {
      dom.reportSelectionSummary.textContent = "Selecione um nome para preparar o PDF individual.";
      dom.whatsappText.value = "Escolha um colaborador acima para preparar o relatório.";
      dom.printableReport.innerHTML = '<div class="report-select-prompt"><strong>Escolha um colaborador</strong><span>O controle individual aparecerá aqui e poderá ser salvo em uma folha PDF.</span></div>';
      $("#printReportBtn").textContent = "Salvar PDF do colaborador";
      buttons.forEach((button) => { button.disabled = true; });
      return;
    }

    const { entries, advances } = getReportData();
    const groups = groupForReport(entries, advances);
    const hasData = entries.length > 0 || advances.length > 0;
    const selectedName = selectedEmployee === "all"
      ? `${groups.length} colaborador(es), cada um em sua própria folha`
      : groups[0]?.name || dom.reportEmployeeSelect.selectedOptions[0]?.textContent || "Colaborador";
    dom.reportSelectionSummary.textContent = `${selectedName} • ${entries.length} registro(s) • ${advances.length} vale(s)`;
    dom.whatsappText.value = buildWhatsappText(entries, advances);
    dom.printableReport.innerHTML = buildPrintableReport(entries, advances);
    $("#printReportBtn").textContent = selectedEmployee === "all" ? "Salvar PDF — um por folha" : "Salvar PDF deste colaborador";
    buttons.forEach((button) => { button.disabled = !hasData; });
  }

  function reportPeriodText() {
    if (!dom.filterStart.value && !dom.filterEnd.value) return "Todos os lançamentos";
    return `${dom.filterStart.value ? dateBR(dom.filterStart.value) : "Início"} a ${dom.filterEnd.value ? dateBR(dom.filterEnd.value) : "Hoje"}`;
  }

  function groupForReport(entries, advances) {
    const grouped = new Map();
    entries.forEach((entry) => {
      if (!grouped.has(entry.employeeId)) grouped.set(entry.employeeId, { entries: [], advances: [] });
      grouped.get(entry.employeeId).entries.push(entry);
    });
    advances.forEach((advance) => {
      if (!grouped.has(advance.employeeId)) grouped.set(advance.employeeId, { entries: [], advances: [] });
      grouped.get(advance.employeeId).advances.push(advance);
    });
    return [...grouped.entries()].map(([employeeId, group]) => ({ employeeId, name: displayEmployeeName(employeeId, group.entries[0] || group.advances[0]), ...group }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  function buildWhatsappText(entries, advances) {
    if (!entries.length && !advances.length) return `*NESPOLI CONCRETO*\nControles de acesso e pagamentos\nPeríodo: ${reportPeriodText()}\n\nNenhum lançamento encontrado.`;
    const outstandingItems = entries.filter((entry) => !L.isAbsence(entry)).map((entry) => {
      const calc = calculateEntry(entry);
      return { employeeId: entry.employeeId, status: entry.status, finalValue: calc.valid ? calc.finalValue : 0 };
    });
    const outstanding = L.summarizeOutstanding(outstandingItems, advances);
    let grossTotal = 0, paid = 0, advancesTotal = 0;
    const sections = groupForReport(entries, advances).map(({ name, entries: items, advances: employeeAdvances }) => {
      let subtotal = 0, minutes = 0;
      const absenceCount = items.filter(L.isAbsence).length;
      const lines = items.sort((a, b) => a.date.localeCompare(b.date)).map((entry) => {
        if (L.isAbsence(entry)) return `• ${dateBR(entry.date)} | *FALTA* | ${entry.notes || "Sem justificativa informada"}`;
        const calc = calculateEntry(entry);
        subtotal += calc.finalValue; minutes += calc.workedMinutes; grossTotal += calc.finalValue;
        if (entry.status === "paid") paid += calc.finalValue;
        const adjustment = calc.manualValue !== null ? ` • ajuste: ${entry.manualReason || "valor manual"}` : "";
        const balance = entry.valueMode === "balance8h" ? ` • saldo ${L.formatSignedDuration(calc.balanceMinutes)}` : "";
        const paymentLabel = entry.status === "paid"
          ? `Pago${entry.paidDate ? ` em ${dateBR(entry.paidDate)}` : ""}`
          : "Não pago";
        return `• ${dateBR(entry.date)} | ${entry.start}–${entry.end} | ${L.formatDuration(calc.workedMinutes)} | ${paymentBaseLabel(calc)} | ${currency.format(calc.finalValue)} | ${paymentLabel}${balance}${adjustment}`;
      });
      const employeeAdvancesTotal = employeeAdvances.reduce((sum, advance) => sum + Number(advance.value), 0);
      advancesTotal += employeeAdvancesTotal;
      const advanceLines = employeeAdvances.sort((a, b) => a.date.localeCompare(b.date)).map((advance) => `• VALE ${dateBR(advance.date)} | − ${currency.format(advance.value)} | ${advance.note || "Vale/adiantamento"}`);
      return `*${name}*\n${[...lines, ...advanceLines].join("\n")}\nHoras: ${L.formatDuration(minutes)}\nFaltas: ${absenceCount}\nBruto: ${currency.format(subtotal)}\nVales: − ${currency.format(employeeAdvancesTotal)}\n*Líquido: ${currency.format(subtotal - employeeAdvancesTotal)}*`;
    });
    return `*NESPOLI CONCRETO*\n*Controles de acesso e pagamentos*\nPeríodo: ${reportPeriodText()}\n\n${sections.join("\n\n")}\n\nTotal bruto: ${currency.format(grossTotal)}\nVales: − ${currency.format(advancesTotal)}\n*TOTAL LÍQUIDO: ${currency.format(grossTotal - advancesTotal)}*\nJornadas pagas: ${currency.format(paid)}\nSaldo não pago após vales: ${currency.format(outstanding.pendingNet)}\n\nMensagem preparada pelo sistema. Confira antes de enviar.`;
  }

  function buildPrintableReport(entries, advances) {
    const groups = groupForReport(entries, advances);
    if (!groups.length) {
      return '<div class="empty-state"><h3>Nenhum lançamento encontrado</h3><p>Altere os filtros para gerar os controles de acesso e pagamentos.</p></div>';
    }

    const generatedAt = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

    return groups.map(({ name, entries: items, advances: employeeAdvances }, groupIndex) => {
      let subtotal = 0, minutes = 0;
      let paidSubtotal = 0, pendingSubtotal = 0;
      const absenceCount = items.filter(L.isAbsence).length;
      const workItems = items.filter((entry) => !L.isAbsence(entry));
      const rows = items.sort((a, b) => a.date.localeCompare(b.date)).map((entry) => {
        if (L.isAbsence(entry)) {
          return `<tr class="absence-row"><td>${dateBR(entry.date)}</td><td colspan="4"><strong>FALTA</strong><div class="report-absence-note">${escapeHTML(entry.notes || "Sem justificativa informada")}</div></td><td>${currency.format(0)}</td><td>Falta registrada</td></tr>`;
        }
        const calc = calculateEntry(entry);
        subtotal += calc.finalValue;
        minutes += calc.workedMinutes;
        if (entry.status === "paid") paidSubtotal += calc.finalValue;
        else pendingSubtotal += calc.finalValue;
        const balance = entry.valueMode === "balance8h" ? `<div class="report-adjustment">Saldo de 8h: ${L.formatSignedDuration(calc.balanceMinutes)}</div>` : "";
        const adjustment = calc.manualValue !== null ? `<div class="report-adjustment">Ajuste: ${escapeHTML(entry.manualReason || "Valor manual")}</div>` : "";
        const paymentLabel = entry.status === "paid"
          ? `Pago${entry.paidDate ? `<div class="report-payment-date">em ${dateBR(entry.paidDate)}</div>` : ""}`
          : "Não pago";
        const interval = entry.breakStart && entry.breakEnd ? `${entry.breakStart}–${entry.breakEnd}` : "Sem intervalo";
        return `<tr><td>${dateBR(entry.date)}</td><td>${entry.start}–${entry.end}</td><td>${interval}</td><td>${L.formatDuration(calc.workedMinutes)}</td><td>${escapeHTML(paymentBaseLabel(calc))}<div class="report-adjustment">${currency.format(calc.hourlyRate)}/h</div></td><td>${currency.format(calc.finalValue)}${balance}${adjustment}</td><td>${paymentLabel}</td></tr>`;
      }).join("");
      const employeeAdvancesTotal = employeeAdvances.reduce((sum, advance) => sum + Number(advance.value), 0);
      const advanceRows = employeeAdvances.sort((a, b) => a.date.localeCompare(b.date)).map((advance) => `<tr><td>${dateBR(advance.date)}</td><td>${escapeHTML(advance.note || "Vale/adiantamento")}</td><td>− ${currency.format(advance.value)}</td></tr>`).join("");
      const netTotal = subtotal - employeeAdvancesTotal;
      const pendingNetSubtotal = pendingSubtotal === 0 ? 0 : pendingSubtotal - employeeAdvancesTotal;
      const paymentSummary = L.summarizePayments(workItems);
      const statusLabel = workItems.length
        ? paymentStatusText(paymentSummary)
        : absenceCount ? `${absenceCount} ${absenceCount === 1 ? "falta registrada" : "faltas registradas"}` : "Somente vales";
      const lastClass = groupIndex === groups.length - 1 ? " is-last" : "";
      const reportRowCount = items.length + employeeAdvances.length;
      const densityClass = reportRowCount > 22 ? " print-ultra-compact" : reportRowCount > 14 ? " print-compact" : "";

      return `<section class="payslip${lastClass}${densityClass}">
        <header class="payslip-header">
          <div class="payslip-company"><div class="payslip-logo"><img src="logo-nespoli-concreto.png" alt="Nespoli Concreto"></div><div><strong>NESPOLI CONCRETO</strong><span>Controle de acesso e pagamentos</span></div></div>
          <div class="payslip-heading"><span>Relatório individual</span><strong>ACESSO E PAGAMENTOS</strong></div>
        </header>
        <div class="payslip-meta">
          <div><span>Colaborador</span><strong>${escapeHTML(name)}</strong></div>
          <div><span>Período</span><strong>${reportPeriodText()}</strong></div>
          <div><span>Situação</span><strong>${statusLabel}</strong></div>
          <div><span>Emitido em</span><strong>${generatedAt}</strong></div>
        </div>
        <div class="payslip-block">
          <h3>Jornadas e faltas do período</h3>
          <div class="table-wrap"><table><thead><tr><th>Data</th><th>Jornada</th><th>Intervalo</th><th>Horas</th><th>Base de cálculo</th><th>Valor</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="7">Sem jornadas no período.</td></tr>'}</tbody></table></div>
        </div>
        ${advanceRows ? `<div class="payslip-block payslip-advances"><h3>Vales / adiantamentos</h3><div class="table-wrap"><table><thead><tr><th>Data do vale</th><th>Descrição</th><th>Desconto</th></tr></thead><tbody>${advanceRows}</tbody></table></div></div>` : ""}
        <div class="payslip-totals">
          <div><span>Horas trabalhadas</span><strong>${L.formatDuration(minutes)}</strong></div>
          <div><span>Valor bruto</span><strong>${currency.format(subtotal)}</strong></div>
          <div><span>Vales</span><strong>− ${currency.format(employeeAdvancesTotal)}</strong></div>
          <div class="payslip-net"><span>Valor líquido</span><strong>${currency.format(netTotal)}</strong></div>
        </div>
        <div class="payslip-payment-details"><span>Faltas registradas: <strong>${absenceCount}</strong></span><span>Jornadas pagas: <strong>${currency.format(paidSubtotal)}</strong></span><span>Saldo não pago após vales: <strong>${currency.format(pendingNetSubtotal)}</strong></span></div>
        <div class="payslip-receipt">
          <p>Declaro que conferi as jornadas, as faltas, os vales e os valores acima referentes ao período informado.</p>
          <p class="payslip-date-line">Tangará da Serra, ______ de ____________________ de __________.</p>
          <div class="signature-line"><span></span><strong>${escapeHTML(name)}</strong><small>Assinatura do colaborador</small></div>
        </div>
      </section>`;
    }).join("");
  }

  async function copyWhatsapp() {
    try {
      await navigator.clipboard.writeText(dom.whatsappText.value);
      toast("Relatório copiado. Agora é só abrir o WhatsApp e colar.");
    } catch {
      dom.whatsappText.focus(); dom.whatsappText.select();
      document.execCommand("copy");
      toast("Relatório copiado. Agora é só abrir o WhatsApp e colar.");
    }
  }

  function exportCSV() {
    const { entries, advances } = getReportData();
    const lines = [["Tipo", "Colaborador", "Data", "Entrada", "Saída intervalo", "Retorno", "Saída final", "Horas líquidas", "Saldo em relação a 8h", "Forma de pagamento", "Base de cálculo", "Valor por hora", "Valor calculado", "Valor final", "Ajuste", "Motivo do ajuste", "Status", "Data do pagamento", "Observação"]];
    entries.forEach((entry) => {
      if (L.isAbsence(entry)) {
        lines.push(["FALTA", displayEmployeeName(entry.employeeId, entry), dateBR(entry.date), "", "", "", "", "0h00", "", "", "", "", "0.00", "0.00", "", "", "Falta registrada", "", entry.notes || "Sem justificativa informada"]);
        return;
      }
      const calc = calculateEntry(entry);
      lines.push([entry.valueMode === "balance8h" ? "SALDO DE HORAS" : "JORNADA", displayEmployeeName(entry.employeeId, entry), dateBR(entry.date), entry.start, entry.breakStart || "", entry.breakEnd || "", entry.end, L.formatDuration(calc.workedMinutes), entry.valueMode === "balance8h" ? L.formatSignedDuration(calc.balanceMinutes) : "", calc.paymentType === "monthly" ? "Mensalista" : "Diária", calc.paymentType === "monthly" ? calc.monthlySalary.toFixed(2) : calc.dailyRate.toFixed(2), calc.hourlyRate.toFixed(2), calc.calculatedValue.toFixed(2), calc.finalValue.toFixed(2), calc.adjustment.toFixed(2), entry.manualReason || "", entry.status === "paid" ? "Pago" : "Não pago", entry.paidDate ? dateBR(entry.paidDate) : "", entry.notes || ""]);
    });
    advances.forEach((advance) => lines.push(["VALE", displayEmployeeName(advance.employeeId, advance), dateBR(advance.date), "", "", "", "", "", "", "", "", "", "", (-Number(advance.value)).toFixed(2), "", "", "Desconto", "", advance.note || "Vale/adiantamento"]));
    const csv = "\uFEFF" + lines.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    downloadBlob(csv, `relatorio-nespoli-concreto-${todayISO()}.csv`, "text/csv;charset=utf-8");
    toast("Planilha CSV baixada.");
  }

  function backupPayload() {
    return { app: "Nespoli Concreto — Ponto e Pagamentos", backupVersion: 5, exportedAt: new Date().toISOString(), data: state };
  }

  function exportBackup() {
    downloadBlob(JSON.stringify(backupPayload(), null, 2), `backup-nespoli-concreto-${todayISO()}.json`, "application/json");
    toast("Backup baixado com sucesso.");
  }

  async function copyBackupData() {
    const content = JSON.stringify(backupPayload());
    dom.backupText.value = content;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
        copied = true;
      }
    } catch (error) {
      console.warn("Cópia automática indisponível", error);
    }
    if (!copied) {
      dom.backupText.focus();
      dom.backupText.select();
      try { copied = document.execCommand("copy"); } catch { copied = false; }
    }
    toast(copied ? "Dados do backup copiados." : "Os dados estão prontos: selecione o texto e copie.");
  }

  function restoreParsedBackup(parsed) {
    const data = parsed?.data || parsed;
    if (!Array.isArray(data?.employees) || !Array.isArray(data?.entries)) throw new Error("Formato inválido");
    if (!confirm(`Restaurar este backup com ${data.employees.length} colaborador(es), ${data.entries.length} registro(s) de jornada/falta e ${(data.advances || []).length} vale(s)? Os dados atuais serão substituídos.`)) return false;
    state = normalizeState({ version: 5, employees: data.employees, entries: data.entries, advances: data.advances || [], updatedAt: new Date().toISOString() });
    saveState();
    resetEntryForm();
    renderAll();
    dom.backupDialog.close();
    toast("Backup restaurado com sucesso.");
    return true;
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      restoreParsedBackup(JSON.parse(await file.text()));
    } catch {
      toast("Não foi possível restaurar: arquivo de backup inválido.");
    }
  }

  function restoreBackupText() {
    const content = dom.backupText.value.trim();
    if (!content) return toast("Cole os dados do backup no campo acima.");
    try {
      restoreParsedBackup(JSON.parse(content));
    } catch {
      toast("Não foi possível restaurar: texto de backup inválido.");
    }
  }

  function restoreBundledBackup() {
    if (!window.NESPOLI_INITIAL_STATE) return toast("Este arquivo não possui um backup incluído.");
    try {
      restoreParsedBackup({ data: JSON.parse(JSON.stringify(window.NESPOLI_INITIAL_STATE)) });
    } catch {
      toast("Não foi possível carregar o backup incluído.");
    }
  }

  function updateBackupMeta() {
    const last = state.updatedAt ? new Date(state.updatedAt).toLocaleString("pt-BR") : "—";
    const absenceCount = state.entries.filter(L.isAbsence).length;
    const journeyCount = state.entries.length - absenceCount;
    dom.backupMeta.innerHTML = `<strong>Dados atuais</strong><br>${state.employees.length} colaborador(es) • ${journeyCount} jornada(s) • ${absenceCount} falta(s) • ${state.advances.length} vale(s)<br>Última alteração: ${last}<br>Cópia automática: neste aparelho e na nuvem privada.`;
  }

  function downloadBlob(content, filename, type) {
    const link = document.createElement("a");
    let url = "";
    try {
      url = URL.createObjectURL(new Blob([content], { type }));
      link.href = url;
    } catch {
      link.href = `data:${type},${encodeURIComponent(content)}`;
    }
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (url) setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function showError(element, message) { element.textContent = message; element.hidden = false; }
  function hideError(element) { element.hidden = true; element.textContent = ""; }
  function toast(message) {
    clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.add("show");
    toastTimer = setTimeout(() => dom.toast.classList.remove("show"), 3000);
  }
})();
