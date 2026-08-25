// tailwind
import React, { useMemo, useState } from "npm:react@19.2.3";
import { TagoIOProvider, useRealtimeData, useWidget } from "npm:@tago-io/custom-widget-react@2.2.0";
import { AlertCircle, Circle, Inbox, Droplet, Layers, ShieldCheck, Clock, Fuel, Gauge, Sliders, Activity } from "npm:lucide-react@0.562.0";
import { DateTime } from "npm:luxon@3.7.2";

type RecordItem = { variable?: string; value?: unknown; time?: string; unit?: string };

type Pump = {
  index: number;
  active: string;
  name: string;
  status: string;
  flow: string;
  level: string;
  total: string;
  tankMap: string;
  tankName: string;
  tankFactor: string;
  dailyBurn: string;
  refillTime: string;
  refillVol: string;
  autonomyDays: string;
};

const BLUE = "#2563eb";
const GREEN = "#16a34a";
const AMBER = "#d97706";
const RED = "#dc2626";
const INDIGO = "#4f46e5";
const SKY = "#0284c7";
const PURPLE = "#9333ea";

const PUMPS: Pump[] = Array.from({ length: 12 }, (_, position) => {
  const index = position + 1;
  return {
    index,
    active: "ativo_" + index,
    name: "nome_dosador_" + index,
    status: "status_" + index,
    flow: "sp_atual_" + index,
    level: "lsl_" + index,
    total: "totalizador_ml_" + index,
    tankMap: "tanque_dosador_" + index,
    tankName: "nome_lsl_" + index,
    tankFactor: "fator_tanque_" + index,
    dailyBurn: "consumo_dia_lsl_" + index,
    refillTime: "ultimo_enchimento_lsl_" + index,
    refillVol: "volume_reabastecido_lsl_" + index,
    autonomyDays: "autonomia_dias_lsl_" + index,
  };
});

function formatNumber(value: unknown, digits = 1): string {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(parsed)
    : "—";
}

function calcCapacityAndLiters(levelPct: number | undefined, factorRaw: unknown): { liters?: number; totalCapacity?: number } {
  if (levelPct === undefined || !Number.isFinite(levelPct)) return {};
  const factor = Number(factorRaw);
  if (!Number.isFinite(factor) || factor <= 0) return {};

  if (factor > 10) {
    const liters = (levelPct / 100) * factor;
    return { liters, totalCapacity: factor };
  } else {
    const liters = levelPct * factor;
    const totalCapacity = 100 * factor;
    return { liters, totalCapacity };
  }
}

function formatDate(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string" && raw.trim()) {
    const str = raw.trim();
    if (/^\d{2}\/\d{2}(\/\d{4})?$/.test(str)) return str;
    const dtIso = DateTime.fromISO(str);
    if (dtIso.isValid) return dtIso.toFormat("dd/MM/yyyy");
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      const dtJs = DateTime.fromJSDate(parsed);
      if (dtJs.isValid) return dtJs.toFormat("dd/MM/yyyy");
    }
    return str.length > 10 ? str.slice(0, 10) : str;
  }
  if (raw instanceof Date) {
    const dt = DateTime.fromJSDate(raw);
    if (dt.isValid) return dt.toFormat("dd/MM/yyyy");
  }
  return undefined;
}

function formatAutonomy(nominalDaysRaw: unknown): { text: string; tone: string; isWarning: boolean; isCritical: boolean } {
  if (nominalDaysRaw === undefined || nominalDaysRaw === null || nominalDaysRaw === "") {
    return { text: "Sem cálculo", tone: "text-slate-500 bg-slate-100 border-slate-200", isWarning: false, isCritical: false };
  }

  const nomDays = Number(nominalDaysRaw);
  if (!Number.isFinite(nomDays) || nomDays < 0) {
    return { text: "Sem cálculo", tone: "text-slate-500 bg-slate-100 border-slate-200", isWarning: false, isCritical: false };
  }

  const roundedNom = Math.round(nomDays);
  if (roundedNom === 0) {
    return { text: "Sem autonomia", tone: "text-red-700 bg-red-50 border-red-200 font-bold", isWarning: true, isCritical: true };
  }

  const unit = roundedNom === 1 ? "dia" : "dias";
  const text = "~" + roundedNom + " " + unit;

  if (roundedNom <= 1) {
    return { text, tone: "text-red-700 bg-red-50 border-red-200 font-bold", isWarning: true, isCritical: true };
  } else if (roundedNom <= 3) {
    return { text, tone: "text-amber-800 bg-amber-50 border-amber-200 font-bold", isWarning: true, isCritical: false };
  } else {
    return { text, tone: "text-emerald-800 bg-emerald-50 border-emerald-200 font-medium", isWarning: false, isCritical: false };
  }
}

function getPumpState(value: unknown) {
  if (value === null || value === undefined) {
    return {
      label: "SEM TELEMETRIA",
      color: "#64748b",
      tone: "bg-slate-100 text-slate-600 border-slate-200",
      isAttention: false,
      isDosing: false,
    };
  }

  const num = Number(value);
  if (!Number.isFinite(num)) {
    return {
      label: "VALOR INVÁLIDO",
      color: RED,
      tone: "bg-red-100 text-red-800 border-red-200",
      isAttention: true,
      isDosing: false,
    };
  }

  switch (num) {
    case 0:
      return { label: "FALHA", color: RED, tone: "bg-red-100 text-red-800 border-red-200", isAttention: true, isDosing: false };
    case 1:
      return { label: "EMERGÊNCIA", color: RED, tone: "bg-red-100 text-red-800 border-red-200", isAttention: true, isDosing: false };
    case 2:
      return { label: "DESLIGADO", color: "#64748b", tone: "bg-slate-100 text-slate-600 border-slate-200", isAttention: false, isDosing: false };
    case 3:
      return { label: "MANUAL", color: SKY, tone: "bg-sky-100 text-sky-800 border-sky-200", isAttention: false, isDosing: false };
    case 4:
      return { label: "AUTOMÁTICO", color: INDIGO, tone: "bg-indigo-100 text-indigo-800 border-indigo-200", isAttention: false, isDosing: false };
    case 5:
      return { label: "AGUARDANDO AUTO", color: AMBER, tone: "bg-amber-100 text-amber-800 border-amber-200", isAttention: false, isDosing: false };
    case 6:
      return { label: "MISTURA SECA", color: PURPLE, tone: "bg-purple-100 text-purple-800 border-purple-200", isAttention: false, isDosing: false };
    case 7:
      return { label: "DOSANDO", color: GREEN, tone: "bg-emerald-100 text-emerald-800 border-emerald-300 ring-1 ring-emerald-200", isAttention: false, isDosing: true };
    default:
      return {
        label: num > 7 ? ("STATUS " + num) : "VALOR INVÁLIDO",
        color: RED,
        tone: "bg-red-100 text-red-800 border-red-200",
        isAttention: true,
        isDosing: false,
      };
  }
}

function parseTankTarget(rawVal: unknown, defaultIndex: number): number {
  if (typeof rawVal === "string" && rawVal.trim()) {
    const match = rawVal.trim().match(/\d+/);
    if (match) {
      const idx = parseInt(match[0], 10);
      if (idx >= 1 && idx <= 12) return idx;
    }
  } else if (typeof rawVal === "number" && Number.isInteger(rawVal) && rawVal >= 1 && rawVal <= 12) {
    return rawVal;
  }
  return defaultIndex;
}

function UnifiedOverview() {
  const { isLoading } = useWidget();
  const { records } = useRealtimeData();
  const [filterMode, setFilterMode] = useState<"all" | "attention" | "critical">("all");

  const latestMap = useMemo(() => {
    const map = new Map<string, RecordItem>();
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (rec && rec.variable) {
        const existing = map.get(rec.variable);
        if (!existing || new Date(rec.time ?? 0).getTime() > new Date(existing.time ?? 0).getTime()) {
          map.set(rec.variable, rec);
        }
      }
    }
    return map;
  }, [records]);

  const activeDosers = useMemo(() => {
    return PUMPS.map((p) => {
      const activeRec = latestMap.get(p.active);
      const nameRec = latestMap.get(p.name);
      const statusRec = latestMap.get(p.status);
      const flowRec = latestMap.get(p.flow);
      const levelRec = latestMap.get(p.level);
      const totalRec = latestMap.get(p.total);
      const tankMapRec = latestMap.get(p.tankMap);
      const tankNameRec = latestMap.get(p.tankName);
      const tankFactorRec = latestMap.get(p.tankFactor);

      let isEnabled = true;
      if (activeRec !== undefined && activeRec.value !== null) {
        isEnabled = activeRec.value === true || String(activeRec.value).toLowerCase() === "true" || Number(activeRec.value) === 1;
      } else if (statusRec !== undefined && statusRec.value !== null) {
        isEnabled = Number(statusRec.value) !== 2;
      } else {
        isEnabled = Boolean(nameRec || flowRec || totalRec || statusRec);
      }

      const tankIndex = parseTankTarget(tankMapRec?.value, p.index);
      const tankLevelRec = latestMap.get("lsl_" + tankIndex) || levelRec;
      const tankFactorVal = latestMap.get("fator_tanque_" + tankIndex)?.value ?? tankFactorRec?.value;
      const targetProductNameRec = latestMap.get("nome_lsl_" + tankIndex) || tankNameRec;

      const productName = typeof targetProductNameRec?.value === "string" && targetProductNameRec.value.trim()
        ? targetProductNameRec.value.trim()
        : ("Tanque " + String(tankIndex).padStart(2, "0"));

      const doserName = typeof nameRec?.value === "string" && nameRec.value.trim()
        ? nameRec.value.trim()
        : ("Dosador " + String(p.index).padStart(2, "0"));

      const lastSeen = [activeRec, nameRec, statusRec, flowRec, levelRec, totalRec, tankMapRec]
        .map((r) => r?.time)
        .filter((tm): tm is string => Boolean(tm))
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

      return {
        ...p,
        doserName,
        productName,
        tankIndex,
        statusVal: statusRec?.value,
        flowVal: flowRec?.value,
        totalVal: totalRec?.value,
        levelVal: tankLevelRec?.value,
        tankFactorVal,
        isEnabled,
        lastSeen,
      };
    }).filter((p) => p.isEnabled);
  }, [latestMap]);

  const dosersByTank = useMemo(() => {
    const map = new Map<number, string[]>();
    activeDosers.forEach((doser) => {
      if (!map.has(doser.tankIndex)) map.set(doser.tankIndex, []);
      map.get(doser.tankIndex)!.push(doser.doserName);
    });
    return map;
  }, [activeDosers]);

  const activeTanks = useMemo(() => {
    const list = [];
    for (let i = 1; i <= 12; i++) {
      const linkedDosers = dosersByTank.get(i) || [];
      const explicitActiveRec = latestMap.get("ativo_lsl_" + i);
      const isExplicitActive = explicitActiveRec !== undefined && explicitActiveRec.value !== null
        ? (explicitActiveRec.value === true || String(explicitActiveRec.value).toLowerCase() === "true" || Number(explicitActiveRec.value) === 1)
        : undefined;

      const isTankActive = isExplicitActive !== undefined ? isExplicitActive : linkedDosers.length > 0;
      if (!isTankActive) continue;

      const levelRec = latestMap.get("lsl_" + i);
      const nameRec = latestMap.get("nome_lsl_" + i);
      const factorRec = latestMap.get("fator_tanque_" + i);
      const consRec = latestMap.get("consumo_dia_lsl_" + i);
      const autoNomRec = latestMap.get("autonomia_dias_lsl_" + i);
      const refillDateRec = latestMap.get("ultimo_enchimento_lsl_" + i);
      const refillVolRec = latestMap.get("volume_reabastecido_lsl_" + i);

      const levelVal = Number.isFinite(Number(levelRec?.value)) ? Number(levelRec?.value) : undefined;
      const factorVal = Number.isFinite(Number(factorRec?.value)) ? Number(factorRec?.value) : undefined;
      const consumptionLiters = Number.isFinite(Number(consRec?.value)) ? Number(consRec?.value) : undefined;
      const refillVolume = Number.isFinite(Number(refillVolRec?.value)) && Number(refillVolRec?.value) > 0 ? Number(refillVolRec?.value) : undefined;
      const refillDate = formatDate(refillDateRec?.value);
      const autonomy = formatAutonomy(autoNomRec?.value);

      const productName = typeof nameRec?.value === "string" && nameRec.value.trim()
        ? nameRec.value.trim()
        : ("Tanque " + String(i).padStart(2, "0"));

      const isCriticalLevel = levelVal !== undefined && levelVal <= 10;
      const isLowLevel = levelVal !== undefined && levelVal > 10 && levelVal <= 20;
      const needsAttention = isCriticalLevel || isLowLevel || autonomy.isWarning;

      const lastUpdated = [levelRec, nameRec, factorRec, consRec, autoNomRec, refillDateRec, refillVolRec]
        .map((r) => r?.time)
        .filter((tm): tm is string => Boolean(tm))
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

      list.push({
        index: i,
        productName,
        level: levelVal,
        factor: factorVal,
        consumptionLiters,
        refillVolume,
        refillDate,
        autonomy,
        linkedDosers,
        isCriticalLevel,
        isLowLevel,
        needsAttention,
        lastUpdated,
      });
    }
    return list;
  }, [latestMap, dosersByTank]);

  const alertsList = useMemo(() => {
    const tankAlerts = activeTanks.filter((t) => t.needsAttention).map((t) => {
      let desc = "";
      if (t.isCriticalLevel) desc = "🚨 Nível Crítico (" + formatNumber(t.level, 0) + "% ≤ 10%) - Reabastecimento urgente!";
      else if (t.isLowLevel) desc = "Nível baixo no tanque (" + formatNumber(t.level, 0) + "% ≤ 20%). Programar compra.";
      else desc = "Alerta de autonomia reduzida (" + t.autonomy.text + ").";
      return {
        id: "tank-" + t.index,
        title: "Tanque " + t.index + " — " + t.productName,
        subtitle: "Dosadores: " + t.linkedDosers.join(", "),
        desc,
        isCritical: t.isCriticalLevel,
      };
    });

    const doserAlerts = activeDosers.filter((d) => {
      const st = getPumpState(d.statusVal);
      const lvl = Number(d.levelVal);
      return st.isAttention || (Number.isFinite(lvl) && lvl <= 10);
    }).map((d) => {
      const st = getPumpState(d.statusVal);
      const lvl = Number(d.levelVal);
      let desc = "";
      if (st.isAttention) desc = "Status Operacional em Alerta: " + st.label;
      else desc = "Nível do tanque associado em estado crítico (" + formatNumber(lvl, 0) + "% ≤ 10%)";
      return {
        id: "doser-" + d.index,
        title: d.doserName,
        subtitle: "T" + d.tankIndex + " (" + d.productName + ")",
        desc,
        isCritical: st.isAttention || lvl <= 10,
      };
    });

    return [...tankAlerts, ...doserAlerts];
  }, [activeTanks, activeDosers]);

  const hasAlerts = alertsList.length > 0;
  const effectiveFilter = hasAlerts ? filterMode : "all";

  const filteredTanks = useMemo(() => {
    if (effectiveFilter === "critical") return activeTanks.filter((t) => t.isCriticalLevel);
    if (effectiveFilter === "attention") return activeTanks.filter((t) => t.needsAttention);
    return activeTanks;
  }, [activeTanks, effectiveFilter]);

  const filteredDosers = useMemo(() => {
    if (effectiveFilter === "critical") {
      return activeDosers.filter((d) => getPumpState(d.statusVal).isAttention || Number(d.levelVal) <= 10);
    }
    if (effectiveFilter === "attention") {
      return activeDosers.filter((d) => getPumpState(d.statusVal).isAttention || Number(d.levelVal) <= 20);
    }
    return activeDosers;
  }, [activeDosers, effectiveFilter]);

  if (isLoading) {
    return (
      <div className="grid h-full grid-cols-2 md:grid-cols-3 gap-4 p-4 animate-pulse bg-slate-50">
        <div className="h-44 rounded-xl bg-slate-200 col-span-full" />
        <div className="h-64 rounded-xl bg-slate-200 col-span-full" />
      </div>
    );
  }

  if (!activeDosers.length && !activeTanks.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-slate-400 bg-white rounded-xl border border-slate-200">
        <Inbox className="h-12 w-12 text-slate-300" strokeWidth={1.5} />
        <p className="text-sm font-medium">Nenhum dosador ou tanque ativo configurado no momento.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-3 text-slate-900 bg-slate-50/60 font-sans">
      {/* Barra de Título e Filtros Condicionais */}
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0 bg-white border border-slate-200/80 rounded-xl px-3.5 py-2 shadow-xs">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-blue-600" />
          <h1 className="text-xs font-bold uppercase tracking-wider text-slate-800">
            Resumo Operacional — Tanques & Dosadores
          </h1>
          <span className="text-[11px] text-slate-500 font-medium">
            ({activeTanks.length} {activeTanks.length === 1 ? "tanque" : "tanques"} • {activeDosers.length} {activeDosers.length === 1 ? "dosador" : "dosadores"})
          </span>
        </div>

        {hasAlerts ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setFilterMode("all")}
              className={"px-2.5 py-1 text-xs font-semibold rounded-lg transition-all " + (
                effectiveFilter === "all" ? "bg-slate-900 text-white shadow-xs" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              Todos
            </button>
            <button
              onClick={() => setFilterMode("attention")}
              className={"px-2.5 py-1 text-xs font-semibold rounded-lg transition-all " + (
                effectiveFilter === "attention" ? "bg-amber-600 text-white shadow-xs" : "bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200"
              )}
            >
              Atenção ({alertsList.length})
            </button>
            <button
              onClick={() => setFilterMode("critical")}
              className={"px-2.5 py-1 text-xs font-semibold rounded-lg transition-all " + (
                effectiveFilter === "critical" ? "bg-red-600 text-white shadow-xs" : "bg-red-50 text-red-800 hover:bg-red-100 border border-red-200"
              )}
            >
              Críticos ({alertsList.filter((a) => a.isCritical).length})
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-semibold bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200/80">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>Operação e níveis normais</span>
          </div>
        )}
      </div>

      {/* SEÇÃO 1: GESTÃO DE ARMAZENAMENTO (TANQUES) */}
      {filteredTanks.length > 0 && (
        <section className="shrink-0 bg-white border border-slate-200/90 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <Droplet className="h-4 w-4 text-blue-600" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Armazenamento de Produtos & Tanques
              </h2>
            </div>
            <span className="text-[11px] text-slate-500 font-medium">
              {filteredTanks.length} {filteredTanks.length === 1 ? "tanque monitorado" : "tanques monitorados"}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3.5">
            {filteredTanks.map((tank) => (
              <TankCard key={tank.index} tank={tank} />
            ))}
          </div>
        </section>
      )}

      {/* SEÇÃO 2: DOSADORES OPERACIONAIS */}
      {filteredDosers.length > 0 && (
        <section className="shrink-0 bg-white border border-slate-200/90 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-600" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Dosadores Operacionais
              </h2>
            </div>
            <span className="text-[11px] text-slate-500 font-medium">
              {filteredDosers.length} {filteredDosers.length === 1 ? "dosador em operação" : "dosadores em operação"}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3.5">
            {filteredDosers.map((doser) => (
              <DoserPumpCard key={doser.index} doser={doser} />
            ))}
          </div>
        </section>
      )}

      {/* SEÇÃO 3: PAINEL DE ALERTAS */}
      {hasAlerts && (
        <div className="mt-1 shrink-0">
          <CombinedAttentionPanel alerts={alertsList} />
        </div>
      )}
    </div>
  );
}

function TankCard({ tank }: { tank: any }) {
  const { liters, totalCapacity } = calcCapacityAndLiters(tank.level, tank.factor);
  const communication = tank.lastUpdated ? DateTime.fromISO(tank.lastUpdated).toFormat("dd/MM HH:mm") : "Sem leitura";

  return (
    <section className={"flex flex-col justify-between overflow-hidden rounded-xl border bg-slate-50/70 p-3.5 shadow-xs hover:bg-slate-50 transition-all " + (
      tank.isCriticalLevel ? "border-red-300 ring-1 ring-red-200 bg-red-50/40" : tank.isLowLevel ? "border-amber-300" : "border-slate-200"
    )}>
      <div>
        <div className="flex items-start justify-between gap-1 mb-1">
          <span className="inline-block px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-white border border-slate-200 text-slate-700">
            Tanque {tank.index}
          </span>
          {tank.isCriticalLevel && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold bg-red-100 text-red-700 border border-red-200 animate-pulse">
              CRÍTICO ≤10%
            </span>
          )}
          {!tank.isCriticalLevel && tank.isLowLevel && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
              NÍVEL BAIXO
            </span>
          )}
        </div>
        <h3 className="text-xs font-bold text-slate-800 truncate" title={tank.productName}>
          {tank.productName}
        </h3>

        <div className="mt-3 flex gap-3 p-2.5 rounded-lg bg-white border border-slate-100 shadow-xs">
          <div className="shrink-0">
            <VerticalTankGauge level={tank.level} factor={tank.factor} />
          </div>

          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5 text-[11px]">
            <div className="border-b border-slate-100 pb-1.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <Droplet className="h-2.5 w-2.5 text-blue-500" />
                Consumo Acumulado
              </span>
              <p className="mt-0.5 text-sm font-extrabold tabular-nums text-slate-900">
                {tank.consumptionLiters !== undefined ? (formatNumber(tank.consumptionLiters, 1) + " L") : "—"}
              </p>
            </div>

            <div className="py-1 border-b border-slate-100">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <Clock className="h-2.5 w-2.5 text-slate-400" />
                Autonomia
              </span>
              <div className="mt-0.5">
                <span className={"inline-block px-1.5 py-0.5 rounded border text-[10px] font-semibold tabular-nums " + tank.autonomy.tone}>
                  {tank.autonomy.text}
                </span>
              </div>
            </div>

            <div className="pt-1">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <Fuel className="h-2.5 w-2.5 text-slate-400" />
                Último Enchimento
              </span>
              <p className="mt-0.5 text-[10px] font-medium text-slate-700 tabular-nums truncate">
                {tank.refillVolume !== undefined && tank.refillDate
                  ? ("+" + formatNumber(tank.refillVolume, 0) + " L (" + tank.refillDate + ")")
                  : tank.refillVolume !== undefined
                  ? ("+" + formatNumber(tank.refillVolume, 0) + " L")
                  : tank.refillDate
                  ? tank.refillDate
                  : "Sem registro"}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-2.5 px-1">
          <div className="flex items-center gap-1 text-[10px] text-slate-500">
            <span className="font-semibold text-slate-600 shrink-0">Dosadores:</span>
            <span className="truncate text-slate-700 font-medium" title={tank.linkedDosers.length ? tank.linkedDosers.join(", ") : "Nenhum dosador vinculado"}>
              {tank.linkedDosers.length ? tank.linkedDosers.join(", ") : "Nenhum vinculado"}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[9px] text-slate-400">
        <span>Leitura: {communication}</span>
        {liters !== undefined && totalCapacity && (
          <span className="font-medium text-slate-500">{formatNumber(liters, 0)} / {formatNumber(totalCapacity, 0)} L</span>
        )}
      </div>
    </section>
  );
}

function DoserPumpCard({ doser }: { doser: any }) {
  const pumpState = getPumpState(doser.statusVal);
  const communication = doser.lastSeen ? DateTime.fromISO(doser.lastSeen).toFormat("dd/MM HH:mm") : "Sem leitura";
  const { liters: estTankLiters } = calcCapacityAndLiters(Number(doser.levelVal), doser.tankFactorVal);
  const levelVal = Number(doser.levelVal);
  const isLevelCritical = Number.isFinite(levelVal) && levelVal <= 10;
  const isLevelLow = Number.isFinite(levelVal) && levelVal > 10 && levelVal <= 20;

  return (
    <section className={"flex flex-col justify-between overflow-hidden rounded-xl border bg-slate-50/70 p-3.5 shadow-xs hover:bg-slate-50 transition-all " + (
      pumpState.isAttention ? "border-red-300 ring-1 ring-red-200 bg-red-50/30" : "border-slate-200"
    )}>
      <div>
        <div className="flex items-start justify-between gap-1 mb-1">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="inline-block px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-white border border-slate-200 text-slate-700">
                Dosador {doser.index}
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-50 text-blue-700 border border-blue-100 truncate" title={"Consome do Tanque " + doser.tankIndex + ": " + doser.productName}>
                <Droplet className="h-2 w-2 text-blue-500 shrink-0" />
                T{doser.tankIndex} ({doser.productName})
              </span>
            </div>
            <h3 className="text-xs font-bold text-slate-800 truncate" title={doser.doserName}>
              {doser.doserName}
            </h3>
          </div>

          <span className={"inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold border " + pumpState.tone}>
            <Circle className="h-1.5 w-1.5 fill-current" />
            {pumpState.label}
          </span>
        </div>

        <div className="mt-3 flex gap-3 p-2.5 rounded-lg bg-white border border-slate-100 shadow-xs">
          {/* Gráfico Flat da Bomba Dosadora à Esquerda */}
          <div className="shrink-0 flex items-center justify-center">
            <DiaphragmPumpGraphic isDosing={pumpState.isDosing} isAttention={pumpState.isAttention} color={pumpState.color} />
          </div>

          {/* Métricas Principais à Direita */}
          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5 text-[11px]">
            {/* 1. Set Point */}
            <div className="border-b border-slate-100 pb-1.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <Sliders className="h-2.5 w-2.5 text-indigo-500" />
                Set Point
              </span>
              <p className="mt-0.5 text-sm font-extrabold tabular-nums text-slate-900">
                {formatNumber(doser.flowVal, 1)}
                <span className="ml-1 text-[10px] font-normal text-slate-500">mL/min</span>
              </p>
            </div>

            {/* 2. Totalizador */}
            <div className="py-1 border-b border-slate-100">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <OdometerIcon className="h-2.5 w-3 text-slate-400 shrink-0" />
                Totalizador
              </span>
              <p className="mt-0.5 text-xs font-extrabold tabular-nums text-slate-900">
                {formatNumber((Number(doser.totalVal) || 0) / 1000, 1)}
                <span className="ml-1 text-[9px] font-normal text-slate-500">L</span>
              </p>
            </div>

            {/* 3. Nível Tanque de Origem */}
            <div className="pt-1">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                <Droplet className="h-2.5 w-2.5 text-slate-400" />
                Nível Tanque {doser.tankIndex}
              </span>
              <p className={"mt-0.5 text-[11px] font-bold tabular-nums " + (isLevelCritical ? "text-red-600 font-extrabold animate-pulse" : isLevelLow ? "text-amber-600 font-bold" : "text-slate-800")}>
                {formatNumber(doser.levelVal, 0)}%
                {estTankLiters !== undefined && (
                  <span className="ml-1 text-[9px] font-medium text-slate-500">
                    (~{formatNumber(estTankLiters, 0)} L)
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[9px] text-slate-400">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: pumpState.color }} />
          <span>{pumpState.label}</span>
        </div>
        <span>Leitura: {communication}</span>
      </div>
    </section>
  );
}


/**
 * Ícone estilizado de Odômetro Mecânico (Tambores rolantes de dígitos)
 */
function OdometerIcon({ className = "h-2.5 w-3 text-slate-400" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Caixa externa em linhas */}
      <rect x="1.5" y="2" width="21" height="14" rx="2.5" />

      {/* Ranhuras verticais divisórias dos rolos mecânicos */}
      <line x1="7" y1="2" x2="7" y2="16" />
      <line x1="12.5" y1="2" x2="12.5" y2="16" />
      <line x1="17.5" y1="2" x2="17.5" y2="16" />
    </svg>
  );
}

function DiaphragmPumpGraphic({
  isDosing,
  isAttention,
  color,
}: {
  isDosing: boolean;
  isAttention: boolean;
  color: string;
}) {
  return (
    <div className="relative flex flex-col items-center select-none w-20 py-1">
      <svg viewBox="0 0 90 100" className="w-20 h-22 drop-shadow-xs" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="36" y="22" width="46" height="56" rx="4" fill="#334155" />
        <rect x="39" y="25" width="40" height="50" rx="3" fill="#1e293b" />

        <line x1="78" y1="32" x2="82" y2="32" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
        <line x1="78" y1="38" x2="82" y2="38" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
        <line x1="78" y1="44" x2="82" y2="44" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
        <line x1="78" y1="50" x2="82" y2="50" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
        <line x1="78" y1="56" x2="82" y2="56" stroke="#475569" strokeWidth="2" strokeLinecap="round" />
        <line x1="78" y1="62" x2="82" y2="62" stroke="#475569" strokeWidth="2" strokeLinecap="round" />

        <rect x="44" y="32" width="28" height="20" rx="2" fill="#0f172a" stroke="#334155" strokeWidth="1" />
        
        <rect x="47" y="35" width="22" height="9" rx="1" fill={isDosing ? "#064e3b" : isAttention ? "#450a0a" : "#0f172a"} />
        <circle cx="51" cy="39.5" r="1.5" fill={isDosing ? "#34d399" : isAttention ? "#f87171" : "#38bdf8"} className={isDosing ? "animate-ping opacity-75" : ""} />
        <line x1="56" y1="39.5" x2="65" y2="39.5" stroke={isDosing ? "#34d399" : "#94a3b8"} strokeWidth="1.5" strokeLinecap="round" />

        <circle cx="49" cy="48" r="1.5" fill="#64748b" />
        <circle cx="56" cy="48" r="1.5" fill="#64748b" />
        <circle cx="63" cy="48" r="1.5" fill="#64748b" />

        <rect x="48" y="58" width="18" height="10" rx="2" fill="#475569" stroke="#64748b" strokeWidth="1" />
        <circle cx="57" cy="63" r="3" fill="#cbd5e1" />
        <line x1="57" y1="61" x2="57" y2="65" stroke="#1e293b" strokeWidth="1" />

        <path d="M42 78 L42 84 L76 84 L76 78 Z" fill="#475569" />
        <circle cx="46" cy="81" r="1" fill="#94a3b8" />
        <circle cx="72" cy="81" r="1" fill="#94a3b8" />

        <path d="M28 34 L36 30 L36 70 L28 66 Z" fill="#64748b" stroke="#475569" strokeWidth="1" />

        <rect x="10" y="28" width="18" height="44" rx="3" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.5" />
        <rect x="12" y="34" width="14" height="32" rx="2" fill="#f1f5f9" />

        <circle cx="13.5" cy="31.5" r="1.2" fill="#94a3b8" />
        <circle cx="24.5" cy="31.5" r="1.2" fill="#94a3b8" />
        <circle cx="13.5" cy="68.5" r="1.2" fill="#94a3b8" />
        <circle cx="24.5" cy="68.5" r="1.2" fill="#94a3b8" />

        <circle cx="19" cy="50" r="6" fill={isDosing ? "#dcfce7" : "#e2e8f0"} stroke={isDosing ? "#16a34a" : "#94a3b8"} strokeWidth="1.5" />
        <circle cx="19" cy="50" r="3" fill={isDosing ? "#22c55e" : "#64748b"} />
        {isDosing && (
          <circle cx="19" cy="50" r="6" stroke="#22c55e" strokeWidth="1.5" className="animate-ping opacity-60" />
        )}

        <path d="M15 28 L15 14 L23 14 L23 28 Z" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1" />
        <rect x="14" y="10" width="10" height="4" rx="1" fill="#cbd5e1" stroke="#64748b" strokeWidth="1" />
        <path d="M19 10 L19 2" stroke={isDosing ? "#16a34a" : "#94a3b8"} strokeWidth="2.5" strokeLinecap="round" />
        {isDosing && (
          <circle cx="19" cy="4" r="1.5" fill="#16a34a" className="animate-bounce" />
        )}

        <path d="M15 72 L15 86 L23 86 L23 72 Z" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1" />
        <rect x="14" y="86" width="10" height="4" rx="1" fill="#cbd5e1" stroke="#64748b" strokeWidth="1" />
        <path d="M19 90 L19 98" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" />
      </svg>

      
    </div>
  );
}

function VerticalTankGauge({ level, factor }: { level?: number; factor?: unknown }) {
  const { liters, totalCapacity } = calcCapacityAndLiters(level, factor);
  const validLevel = level !== undefined && Number.isFinite(level) ? Math.min(Math.max(level, 0), 100) : undefined;
  const isCritical = validLevel !== undefined && validLevel <= 10;
  const isWarning = validLevel !== undefined && validLevel > 10 && validLevel <= 20;

  const liquidGradient = isCritical
    ? "from-red-600 via-rose-500 to-red-400"
    : isWarning
    ? "from-amber-600 via-amber-500 to-yellow-400"
    : "from-blue-700 via-blue-500 to-cyan-400";

  return (
    <div className="flex flex-col items-center select-none w-16">
      <div className="w-11 h-2 rounded-t-full bg-slate-300 border-t border-x border-slate-400 shadow-xs relative">
        <div className="w-3 h-1 bg-slate-400 mx-auto -mt-1 rounded-t-xs" />
      </div>

      <div className="relative w-14 h-24 bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 border-2 border-slate-300 rounded-b-lg overflow-hidden shadow-inner flex flex-col justify-end">
        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between py-1 px-1 z-20 opacity-70">
          <div className="flex justify-between items-center w-full">
            <span className="h-0.5 w-2 bg-slate-400" />
            <span className="text-[7px] font-bold text-slate-600">100%</span>
          </div>
          <div className="flex justify-between items-center w-full">
            <span className="h-0.5 w-1.5 bg-slate-400" />
            <span className="text-[7px] font-bold text-slate-600">75%</span>
          </div>
          <div className="flex justify-between items-center w-full">
            <span className="h-0.5 w-2 bg-slate-400" />
            <span className="text-[7px] font-bold text-slate-600">50%</span>
          </div>
          <div className="flex justify-between items-center w-full">
            <span className="h-0.5 w-1.5 bg-slate-400" />
            <span className="text-[7px] font-bold text-slate-600">25%</span>
          </div>
          <div className="flex justify-between items-center w-full">
            <span className="h-0.5 w-2 bg-slate-400" />
            <span className="text-[7px] font-bold text-slate-600">0%</span>
          </div>
        </div>

        {validLevel !== undefined ? (
          <div
            className={"w-full bg-gradient-to-t " + liquidGradient + " transition-all duration-700 ease-out relative z-10"}
            style={{ height: validLevel + "%" }}
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-white/40 shadow-xs" />
            {isCritical && <div className="absolute inset-0 bg-red-400/30 animate-pulse pointer-events-none" />}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <span className="text-[7px] font-bold text-slate-400 bg-white/80 px-1 py-0.5 rounded">S/ DADO</span>
          </div>
        )}

        {validLevel !== undefined && (
          <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
            <div className={"backdrop-blur-xs px-1.5 py-0.5 rounded text-[9px] font-bold tabular-nums shadow text-white " + (isCritical ? "bg-red-700/90" : "bg-slate-900/80")}>
              {formatNumber(validLevel, 0)}%
            </div>
          </div>
        )}
      </div>

      <div className="w-12 flex justify-between px-1">
        <div className="w-2 h-1 bg-slate-400 rounded-b-xs" />
        <div className="w-2 h-1 bg-slate-400 rounded-b-xs" />
      </div>

      {liters !== undefined && (
        <div className="mt-0.5 text-center">
          <p className={"text-[9px] font-bold tabular-nums " + (isCritical ? "text-red-700" : "text-slate-800")}>
            {formatNumber(liters, 0)} L
          </p>
          {totalCapacity && (
            <p className="text-[7px] text-slate-400">de {formatNumber(totalCapacity, 0)} L</p>
          )}
        </div>
      )}
    </div>
  );
}

function CombinedAttentionPanel({ alerts }: { alerts: any[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm flex flex-col">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
        <AlertCircle className="h-4 w-4 text-amber-600" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
          Painel de Alertas & Atenção Operacional
        </h2>
      </div>
      <div className="mt-2.5 flex-1 space-y-2 overflow-auto max-h-48">
        {alerts.map((item) => {
          const badgeColor = item.isCritical
            ? "bg-red-50 border-red-200 text-red-900"
            : "bg-amber-50/80 border-amber-200/60 text-amber-900";
          const iconColor = item.isCritical ? "text-red-600" : "text-amber-600";

          return (
            <div key={item.id} className={"flex items-start gap-2.5 rounded-lg border p-2.5 text-xs " + badgeColor}>
              <AlertCircle className={"mt-0.5 h-4 w-4 shrink-0 " + iconColor} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-slate-800">{item.title}</p>
                  <span className="text-[10px] font-semibold text-slate-600">{item.subtitle}</span>
                </div>
                <p className="text-[11px] mt-0.5 font-medium">
                  {item.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function App() {
  return (
    <TagoIOProvider realtimeStrategy="merge" realtimeMaxRecords={800}>
      <UnifiedOverview />
    </TagoIOProvider>
  );
}
