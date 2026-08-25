// tailwind
import React, { useMemo } from "npm:react@19.2.3";
import { TagoIOProvider, useRealtimeData, useWidget } from "npm:@tago-io/custom-widget-react@2.2.0";
import { AlertCircle, Circle, Inbox, Droplet, Layers, Activity, ShieldCheck, Clock, Fuel } from "npm:lucide-react@0.562.0";
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
};

const BLUE = "#2563eb";
const GREEN = "#16a34a";
const AMBER = "#d97706";
const RED = "#dc2626";
const INDIGO = "#4f46e5";
const SKY = "#0284c7";
const PURPLE = "#9333ea";

const PRODUCT_COLORS = [
  "#2563eb", "#16a34a", "#9333ea", "#0d9488",
  "#ea580c", "#db2777", "#4f46e5", "#0284c7"
];

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
  };
});

function latest(records: RecordItem[], variable: string) {
  return records
    .filter((record) => record.variable === variable)
    .sort((a, b) => new Date(b.time ?? 0).getTime() - new Date(a.time ?? 0).getTime())[0];
}

function enabled(value: unknown) {
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
}

function number(value: unknown, digits = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(parsed)
    : "—";
}

function calcTankLiters(levelPct: number | undefined, factorRaw: unknown): { liters?: number; totalCapacity?: number } {
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

function formatRefillDate(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string" && raw.trim()) {
    const str = raw.trim();
    // Se já estiver formatado como DD/MM/YYYY ou DD/MM
    if (/^\d{2}\/\d{2}(\/\d{4})?$/.test(str)) {
      return str;
    }
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

/**
 * Detecta enchimento do tanque analisando subidas bruscas de nível (>= +5%)
 * ou através de variável explícita 'ultimo_enchimento_lsl_X' e calcula o volume abastecido
 */
function detectRefillInfo(
  records: RecordItem[],
  tankVar: string,
  factorRaw: unknown,
  explicitRefill?: unknown,
  explicitVolume?: unknown
): { refillDate?: string; refilledLiters?: number } {
  let refillDate = formatRefillDate(explicitRefill);
  let refilledLiters = Number.isFinite(Number(explicitVolume)) && Number(explicitVolume) > 0 ? Number(explicitVolume) : undefined;

  if (refillDate && refilledLiters !== undefined) {
    return { refillDate, refilledLiters };
  }

  const tankRecords = records
    .filter((r) => r.variable === tankVar && r.value !== undefined && Number.isFinite(Number(r.value)))
    .sort((a, b) => new Date(a.time ?? 0).getTime() - new Date(b.time ?? 0).getTime());

  if (tankRecords.length >= 2) {
    let lastRefillTime: string | undefined;
    let lastDeltaPct = 0;

    for (let i = 1; i < tankRecords.length; i++) {
      const prev = Number(tankRecords[i - 1].value);
      const curr = Number(tankRecords[i].value);
      const delta = curr - prev;
      if (delta >= 5 && tankRecords[i].time) {
        lastRefillTime = tankRecords[i].time;
        lastDeltaPct = delta;
      }
    }

    if (!refillDate && lastRefillTime) {
      refillDate = formatRefillDate(lastRefillTime);
    }
    if (refilledLiters === undefined && lastDeltaPct > 0) {
      const { liters } = calcTankLiters(lastDeltaPct, factorRaw);
      if (liters !== undefined && liters > 0) {
        refilledLiters = Math.round(liters);
      }
    }
  }

  return { refillDate, refilledLiters };
}

/**
 * Calcula a estimativa de estoque / autonomia em dias inteiros arredondados e faixa min/max
 */
function calcStockAutonomy(
  currentLiters: number | undefined,
  totalFlowRateMlMin: number,
  explicitDailyBurn?: unknown,
  explicitNominalDays?: unknown,
  explicitMinDays?: unknown,
  explicitMaxDays?: unknown
): { text: string; tone: string } {
  if (currentLiters === undefined || currentLiters <= 0) {
    return { text: "Sem estoque", tone: "text-red-700 bg-red-50 border-red-200" };
  }

  // 1. Se o backend já calculou os dias nominais e o intervalo min/max
  const nomDays = Number(explicitNominalDays);
  const minDays = Number(explicitMinDays);
  const maxDays = Number(explicitMaxDays);

  if (Number.isFinite(nomDays) && nomDays >= 0) {
    const roundedNom = Math.round(nomDays);
    const roundedMin = Number.isFinite(minDays) ? Math.round(minDays) : roundedNom;
    const roundedMax = Number.isFinite(maxDays) ? Math.round(maxDays) : roundedNom;

    if (roundedNom === 0) {
      return { text: "Sem estoque", tone: "text-red-700 bg-red-50 border-red-200 font-bold" };
    }

    const rangeText = roundedMin !== roundedMax ? ` (${roundedMin} a ${roundedMax} d)` : "";
    const unitText = roundedNom === 1 ? "dia" : "dias";
    const text = `~${roundedNom} ${unitText}${rangeText}`;

    if (roundedNom < 1) {
      return { text, tone: "text-red-700 bg-red-50 border-red-200 font-bold" };
    } else if (roundedNom <= 3) {
      return { text, tone: "text-amber-800 bg-amber-50 border-amber-200 font-bold" };
    } else {
      return { text, tone: "text-emerald-800 bg-emerald-50 border-emerald-200 font-medium" };
    }
  }

  // 2. Fallback baseado na taxa de queima diária ou vazão
  let litersPerDay = Number(explicitDailyBurn);
  if (!Number.isFinite(litersPerDay) || litersPerDay <= 0) {
    if (totalFlowRateMlMin > 0) {
      litersPerDay = (totalFlowRateMlMin * 60 * 24) / 1000;
    }
  }

  if (!Number.isFinite(litersPerDay) || litersPerDay <= 0) {
    return { text: "Estoque estável", tone: "text-slate-600 bg-slate-100 border-slate-200" };
  }

  const days = currentLiters / litersPerDay;
  const roundedDays = Math.round(days);
  if (roundedDays < 1) {
    const hours = Math.max(Math.round(days * 24), 1);
    return {
      text: `~${hours}h restantes`,
      tone: "text-red-700 bg-red-50 border-red-200 font-bold",
    };
  } else if (roundedDays <= 3) {
    return {
      text: `~${roundedDays} ${roundedDays === 1 ? "dia restante" : "dias restantes"}`,
      tone: "text-amber-800 bg-amber-50 border-amber-200 font-bold",
    };
  } else {
    return {
      text: `~${roundedDays} dias de autonomia`,
      tone: "text-emerald-800 bg-emerald-50 border-emerald-200",
    };
  }
}

function state(value: unknown) {
  if (value === null || value === undefined) {
    return {
      label: "SEM TELEMETRIA",
      color: "#64748b",
      tone: "bg-slate-100 text-slate-600",
      isAttention: false,
      isDosing: false,
    };
  }

  const num = Number(value);
  if (!Number.isFinite(num)) {
    return {
      label: "VALOR INVÁLIDO",
      color: RED,
      tone: "bg-red-100 text-red-800",
      isAttention: true,
      isDosing: false,
    };
  }

  switch (num) {
    case 0:
      return { label: "FALHA", color: RED, tone: "bg-red-100 text-red-800", isAttention: true, isDosing: false };
    case 1:
      return { label: "EMERGÊNCIA", color: RED, tone: "bg-red-100 text-red-800", isAttention: true, isDosing: false };
    case 2:
      return { label: "DESLIGADO", color: "#64748b", tone: "bg-slate-100 text-slate-600", isAttention: false, isDosing: false };
    case 3:
      return { label: "MANUAL", color: SKY, tone: "bg-sky-100 text-sky-800", isAttention: false, isDosing: false };
    case 4:
      return { label: "AUTOMÁTICO", color: INDIGO, tone: "bg-indigo-100 text-indigo-800", isAttention: false, isDosing: false };
    case 5:
      return { label: "AGUARDANDO AUTO...", color: AMBER, tone: "bg-amber-100 text-amber-800", isAttention: false, isDosing: false };
    case 6:
      return { label: "MISTURA SECA...", color: PURPLE, tone: "bg-purple-100 text-purple-800", isAttention: false, isDosing: false };
    case 7:
      return { label: "DOSANDO", color: GREEN, tone: "bg-emerald-100 text-emerald-800", isAttention: false, isDosing: true };
    case 8:
      return { label: "STATUS 8", color: RED, tone: "bg-red-100 text-red-800", isAttention: true, isDosing: false };
    case 9:
      return { label: "STATUS 9", color: RED, tone: "bg-red-100 text-red-800", isAttention: true, isDosing: false };
    case 10:
      return { label: "STATUS 10", color: RED, tone: "bg-red-100 text-red-800", isAttention: true, isDosing: false };
    default:
      return {
        label: num > 10 ? "STATUS " + num : "VALOR INVÁLIDO",
        color: RED,
        tone: "bg-red-100 text-red-800",
        isAttention: true,
        isDosing: false,
      };
  }
}

function parseTankTarget(rawVal: unknown, defaultIndex: number): { tankVar: string; tankIndex: number } {
  if (typeof rawVal === "string" && rawVal.trim()) {
    const clean = rawVal.trim().toLowerCase();
    const match = clean.match(/\d+/);
    if (match) {
      const idx = parseInt(match[0], 10);
      if (idx >= 1 && idx <= 12) {
        return { tankVar: "lsl_" + idx, tankIndex: idx };
      }
    }
  } else if (typeof rawVal === "number" && Number.isInteger(rawVal) && rawVal >= 1 && rawVal <= 12) {
    return { tankVar: "lsl_" + rawVal, tankIndex: rawVal };
  }
  return { tankVar: "lsl_" + defaultIndex, tankIndex: defaultIndex };
}

function Overview() {
  const { isLoading } = useWidget();
  const { records } = useRealtimeData();

  // Mapeamento dos Tanques (1 a 12)
  const tanksMap = useMemo(() => {
    const map = new Map<number, {
      index: number;
      varName: string;
      productName: string;
      factor?: number;
      levelRecord?: RecordItem;
      factorRecord?: RecordItem;
      dailyBurnRecord?: RecordItem;
      refillRecord?: RecordItem;
      refillVolRecord?: RecordItem;
      refillVolume?: number;
      autonomyNominalRecord?: RecordItem;
      autonomyMinRecord?: RecordItem;
      autonomyMaxRecord?: RecordItem;
      lastRefillDate?: string;
    }>();

    for (let i = 1; i <= 12; i++) {
      const levelRec = latest(records, "lsl_" + i);
      const nameRec = latest(records, "nome_lsl_" + i);
      const factorRec = latest(records, "fator_tanque_" + i);
      const dailyBurnRec = latest(records, "consumo_dia_lsl_" + i);
      const refillRec = latest(records, "ultimo_enchimento_lsl_" + i);
      const refillVolRec = latest(records, "volume_reabastecido_lsl_" + i);
      const autonomyNominalRec = latest(records, "autonomia_dias_lsl_" + i);
      const autonomyMinRec = latest(records, "autonomia_min_lsl_" + i);
      const autonomyMaxRec = latest(records, "autonomia_max_lsl_" + i);

      const productName =
        typeof nameRec?.value === "string" && nameRec.value.trim()
          ? nameRec.value.trim()
          : "Tanque " + String(i).padStart(2, "0");

      const factorVal = Number(factorRec?.value);
      const { refillDate: lastRefillDate, refilledLiters: calculatedRefillVol } = detectRefillInfo(
        records,
        "lsl_" + i,
        factorVal,
        refillRec?.value,
        refillVolRec?.value
      );

      map.set(i, {
        index: i,
        varName: "lsl_" + i,
        productName,
        factor: Number.isFinite(factorVal) ? factorVal : undefined,
        levelRecord: levelRec,
        factorRecord: factorRec,
        dailyBurnRecord: dailyBurnRec,
        refillRecord: refillRec,
        refillVolRecord: refillVolRec,
        refillVolume: calculatedRefillVol,
        autonomyNominalRecord: autonomyNominalRec,
        autonomyMinRecord: autonomyMinRec,
        autonomyMaxRecord: autonomyMaxRec,
        lastRefillDate,
      });
    }
    return map;
  }, [records]);

  // Processamento dos Dosadores
  const model = useMemo(() => {
    const hasExplicitActive = PUMPS.some((pump) => latest(records, pump.active) !== undefined);
    return PUMPS.map((pump) => {
      const active = latest(records, pump.active);
      const name = latest(records, pump.name);
      const status = latest(records, pump.status);
      const flow = latest(records, pump.flow);
      const total = latest(records, pump.total);
      const tankMapRec = latest(records, pump.tankMap);

      const { tankVar, tankIndex } = parseTankTarget(tankMapRec?.value, pump.index);
      const tankInfo = tanksMap.get(tankIndex);
      const level = tankInfo?.levelRecord || latest(records, tankVar);
      const factorRec = tankInfo?.factorRecord || latest(records, "fator_tanque_" + tankIndex);
      const productName = tankInfo?.productName || ("Tanque " + tankIndex);

      const hasTelemetry = Boolean(name || status || flow || level || total || tankMapRec || factorRec);
      const visible = hasExplicitActive ? enabled(active?.value) : hasTelemetry;

      const lastSeen = [active, name, status, flow, level, total, tankMapRec, factorRec]
        .map((item) => item?.time)
        .filter((time): time is string => Boolean(time))
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

      return {
        ...pump,
        name: typeof name?.value === "string" && name.value.trim() ? name.value : ("Dosador " + String(pump.index).padStart(2, "0")),
        status,
        flow,
        level,
        total,
        tankIndex,
        tankVar,
        productName,
        tankFactorVal: factorRec?.value,
        tankInfo,
        visible,
        lastSeen,
      };
    }).filter((pump) => pump.visible);
  }, [records, tanksMap]);

  // Agrupamento por Produto / Tanque e Métricas Gerais
  const { metrics, productStats } = useMemo(() => {
    const dosing = model.filter((pump) => state(pump.status?.value).isDosing);

    // Alerta crítico se nível <= 10% ou status for 0, 1, >= 8
    const attention = model.filter((pump) => {
      const st = state(pump.status?.value);
      const levelVal = Number(pump.level?.value);
      const isCriticalLevel = Number.isFinite(levelVal) && levelVal <= 10;
      const isLowLevel = Number.isFinite(levelVal) && levelVal > 10 && levelVal <= 20;
      return st.isAttention || isCriticalLevel || isLowLevel;
    });

    const productGroups = new Map<number, {
      tankIndex: number;
      productName: string;
      level?: number;
      factor?: number;
      dailyBurn?: unknown;
      autonomyNominal?: unknown;
      autonomyMin?: unknown;
      autonomyMax?: unknown;
      refillVolume?: unknown;
      lastRefillDate?: string;
      totalVolumeL: number;
      totalFlowRate: number;
      pumps: typeof model;
      color: string;
    }>();

    model.forEach((pump) => {
      const tIdx = pump.tankIndex;
      const vol = (Number(pump.total?.value) || 0) / 1000;
      const flow = Number(pump.flow?.value) || 0;
      const level = Number.isFinite(Number(pump.level?.value)) ? Number(pump.level?.value) : undefined;
      const factor = Number.isFinite(Number(pump.tankFactorVal)) ? Number(pump.tankFactorVal) : undefined;
      const dailyBurn = pump.tankInfo?.dailyBurnRecord?.value;
      const autonomyNominal = pump.tankInfo?.autonomyNominalRecord?.value;
      const autonomyMin = pump.tankInfo?.autonomyMinRecord?.value;
      const autonomyMax = pump.tankInfo?.autonomyMaxRecord?.value;
      const refillVolume = pump.tankInfo?.refillVolume ?? pump.tankInfo?.refillVolRecord?.value;
      const lastRefillDate = pump.tankInfo?.lastRefillDate;

      if (!productGroups.has(tIdx)) {
        productGroups.set(tIdx, {
          tankIndex: tIdx,
          productName: pump.productName,
          level,
          factor,
          dailyBurn,
          autonomyNominal,
          autonomyMin,
          autonomyMax,
          refillVolume,
          lastRefillDate,
          totalVolumeL: vol,
          totalFlowRate: flow,
          pumps: [pump],
          color: PRODUCT_COLORS[(tIdx - 1) % PRODUCT_COLORS.length],
        });
      } else {
        const group = productGroups.get(tIdx)!;
        group.totalVolumeL += vol;
        group.totalFlowRate += flow;
        if (level !== undefined && group.level === undefined) group.level = level;
        if (factor !== undefined && group.factor === undefined) group.factor = factor;
        if (lastRefillDate && !group.lastRefillDate) group.lastRefillDate = lastRefillDate;
        if (refillVolume !== undefined && group.refillVolume === undefined) group.refillVolume = refillVolume;
        if (autonomyNominal !== undefined && group.autonomyNominal === undefined) group.autonomyNominal = autonomyNominal;
        if (autonomyMin !== undefined && group.autonomyMin === undefined) group.autonomyMin = autonomyMin;
        if (autonomyMax !== undefined && group.autonomyMax === undefined) group.autonomyMax = autonomyMax;
        group.pumps.push(pump);
      }
    });

    return {
      metrics: { dosing, attention },
      productStats: Array.from(productGroups.values()),
    };
  }, [model]);

  if (isLoading) {
    return (
      <div className="grid h-full grid-cols-2 gap-4 overflow-hidden p-3 animate-pulse bg-slate-50">
        <div className="col-span-2 h-20 rounded-xl bg-slate-200" />
        <div className="col-span-2 h-44 rounded-xl bg-slate-200" />
        <div className="col-span-2 h-full rounded-xl bg-slate-200" />
      </div>
    );
  }

  if (!model.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 overflow-hidden p-6 text-slate-400 bg-white">
        <Inbox className="h-10 w-10 text-slate-300" strokeWidth={1.5} />
        <p className="text-sm font-medium">A unidade selecionada ainda não enviou telemetria dos dosadores.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-3 text-slate-900 bg-slate-50/50">
      {/* Top Global KPIs */}
      <div className="grid shrink-0 grid-cols-1 sm:grid-cols-3 gap-3">
        <MetricCard
          label="DOSADORES DOSANDO"
          value={metrics.dosing.length + "/" + model.length}
          sublabel={metrics.dosing.length === 1 ? "1 dosador ativo" : metrics.dosing.length + " dosadores ativos"}
          accent={GREEN}
          icon={<Activity className="h-4 w-4" />}
        />
        <MetricCard
          label="PRODUTOS / TANQUES"
          value={String(productStats.length)}
          sublabel={productStats.length === 1 ? "1 produto monitorado" : productStats.length + " produtos monitorados"}
          accent={INDIGO}
          icon={<Layers className="h-4 w-4" />}
        />
        <MetricCard
          label="ALERTAS / ATENÇÃO"
          value={String(metrics.attention.length)}
          sublabel={metrics.attention.length === 0 ? "Nenhum alerta ativo" : metrics.attention.length + " itens precisam de atenção"}
          accent={metrics.attention.length > 0 ? RED : GREEN}
          icon={metrics.attention.length > 0 ? <AlertCircle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4 text-emerald-600" />}
        />
      </div>

      {/* Resumo Visual por Tanque / Produto */}
      {productStats.length > 0 && (
        <div className="shrink-0 bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-blue-600" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Volume Acumulado & Nível por Produto / Tanque</h2>
            </div>
            <span className="text-[11px] text-slate-500 font-medium">{productStats.length} {productStats.length === 1 ? "produto" : "produtos"}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3.5">
            {productStats.map((prod) => {
              const { liters: currentLiters } = calcTankLiters(prod.level, prod.factor);
              const autonomy = calcStockAutonomy(
                currentLiters,
                prod.totalFlowRate,
                prod.dailyBurn,
                prod.autonomyNominal,
                prod.autonomyMin,
                prod.autonomyMax
              );
              const isLevelCritical = prod.level !== undefined && prod.level <= 10;

              return (
                <div key={prod.tankIndex} className={"flex gap-3.5 p-3.5 rounded-xl border transition-all shadow-xs " + (isLevelCritical ? "bg-red-50/50 border-red-200" : "bg-slate-50/80 border-slate-200/80 hover:bg-slate-100/80")}>
                  {/* Coluna Visual do Tanque Vertical */}
                  <div className="shrink-0">
                    <VerticalTankGauge level={prod.level} factor={prod.factor} />
                  </div>

                  {/* Informações e Métricas do Produto */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-1 mb-1">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-white border border-slate-200 text-slate-600">
                          Tanque {prod.tankIndex}
                        </span>
                        {isLevelCritical && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold bg-red-100 text-red-700 border border-red-200 animate-pulse">
                            CRÍTICO ≤10%
                          </span>
                        )}
                      </div>
                      <h3 className="text-xs font-bold text-slate-800 line-clamp-1" title={prod.productName}>
                        {prod.productName}
                      </h3>
                    </div>

                    <div className="mt-2 space-y-1.5 border-t border-slate-200/60 pt-2 text-[11px]">
                      {/* Volume Acumulado Dosado */}
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Vol. Acumulado:</span>
                        <span className="font-bold text-slate-900 tabular-nums">{number(prod.totalVolumeL)} L</span>
                      </div>

                      {/* Estimativa de Estoque / Autonomia */}
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Clock className="h-3 w-3 text-slate-400" />
                          Estoque:
                        </span>
                        <span className={"px-1.5 py-0.5 rounded border text-[10px] font-semibold " + autonomy.tone}>
                          {autonomy.text}
                        </span>
                      </div>

                      {/* Último Enchimento */}
                      <div className="flex items-center justify-between text-[10px] pt-0.5">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Fuel className="h-3 w-3 text-slate-400" />
                          Último Ench.:
                        </span>
                        <span className="text-slate-700 font-medium tabular-nums text-[10px]">
                          {prod.refillVolume !== undefined && Number(prod.refillVolume) > 0 && prod.lastRefillDate
                            ? `+${number(prod.refillVolume, 0)} L (${prod.lastRefillDate})`
                            : prod.refillVolume !== undefined && Number(prod.refillVolume) > 0
                            ? `+${number(prod.refillVolume, 0)} L`
                            : prod.lastRefillDate
                            ? prod.lastRefillDate
                            : "Sem registro"}
                        </span>
                      </div>
                    </div>

                    <div className="text-[9px] text-slate-400 mt-2 pt-1 border-t border-slate-200/40 truncate" title={prod.pumps.map((p) => p.name).join(", ")}>
                      Dosadores: {prod.pumps.map((p) => p.name).join(", ")}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Grid de Cards dos Dosadores */}
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {model.map((pump) => (
            <PumpCard key={pump.index} pump={pump} />
          ))}
        </div>

        {/* Painel de Alertas em Largura Total */}
        <div className="mt-4">
          <AttentionPanel pumps={metrics.attention} />
        </div>
      </div>
    </div>
  );
}

/**
 * Componente Visual de Tanque Vertical com Nível de Líquido e Graduação
 */
function VerticalTankGauge({
  level,
  factor,
}: {
  level?: number;
  factor?: unknown;
}) {
  const { liters, totalCapacity } = calcTankLiters(level, factor);
  const validLevel = level !== undefined && Number.isFinite(level) ? Math.min(Math.max(level, 0), 100) : undefined;
  const isCritical = validLevel !== undefined && validLevel <= 10;
  const isWarning = validLevel !== undefined && validLevel > 10 && validLevel <= 25;

  const liquidGradient = isCritical
    ? "from-red-600 via-rose-500 to-red-400"
    : isWarning
    ? "from-amber-600 via-amber-500 to-yellow-400"
    : "from-blue-700 via-blue-500 to-cyan-400";

  return (
    <div className="flex flex-col items-center select-none w-20">
      {/* Topo / Cúpula do Tanque */}
      <div className="w-12 h-2 rounded-t-full bg-slate-300 border-t border-x border-slate-400 shadow-xs relative">
        <div className="w-3 h-1 bg-slate-400 mx-auto -mt-1 rounded-t-xs" />
      </div>

      {/* Corpo do Tanque Cilíndrico com Graduação */}
      <div className="relative w-16 h-28 bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 border-2 border-slate-300 rounded-b-lg overflow-hidden shadow-inner flex flex-col justify-end">
        {/* Marcações de Nível / Ticks */}
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

        {/* Nível de Líquido Preenchido */}
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
            <span className="text-[8px] font-bold text-slate-400 bg-white/80 px-1 py-0.5 rounded">S/ DADO</span>
          </div>
        )}

        {/* Badge Central com Nível % */}
        {validLevel !== undefined && (
          <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
            <div className={"backdrop-blur-xs px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums shadow text-white " + (isCritical ? "bg-red-700/90" : "bg-slate-900/80")}>
              {number(validLevel, 0)}%
            </div>
          </div>
        )}
      </div>

      {/* Pés da Base do Tanque */}
      <div className="w-14 flex justify-between px-1">
        <div className="w-2 h-1 bg-slate-400 rounded-b-xs" />
        <div className="w-2 h-1 bg-slate-400 rounded-b-xs" />
      </div>

      {/* Litros Estimados Abaixo do Tanque */}
      {liters !== undefined ? (
        <div className="mt-1 text-center">
          <p className={"text-[10px] font-bold tabular-nums " + (isCritical ? "text-red-700" : "text-slate-800")}>
            {number(liters, 0)} L
          </p>
          {totalCapacity && (
            <p className="text-[8px] text-slate-400">de {number(totalCapacity, 0)} L</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({ label, value, unit, sublabel, accent, icon }: any) {
  return (
    <section className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="absolute top-0 left-0 bottom-0 w-1.5" style={{ backgroundColor: accent }} />
      <div className="flex items-center justify-between text-slate-500 pl-1.5">
        <p className="text-[10px] font-bold tracking-wider uppercase">{label}</p>
        <div className="text-slate-400">{icon}</div>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5 pl-1.5">
        <span className="text-2xl font-bold tabular-nums text-slate-900">{value}</span>
        {unit && <span className="text-xs font-semibold text-slate-500">{unit}</span>}
      </div>
      {sublabel && <p className="mt-1 text-[10px] text-slate-400 pl-1.5">{sublabel}</p>}
    </section>
  );
}

function PumpCard({ pump }: { pump: any }) {
  const current = state(pump.status?.value);
  const communication = pump.lastSeen ? DateTime.fromISO(pump.lastSeen).toFormat("dd/MM HH:mm") : "Sem leitura";
  const levelVal = Number(pump.level?.value);
  const isLevelCritical = Number.isFinite(levelVal) && levelVal <= 10;
  const isLevelLow = Number.isFinite(levelVal) && levelVal > 10 && levelVal <= 20;
  const { liters: estLiters } = calcTankLiters(Number(pump.level?.value), pump.tankFactorVal);

  return (
    <section className="flex flex-col justify-between overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow transition-shadow">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold text-slate-800" title={pump.name}>
              {pump.name}
            </h2>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-100 truncate" title={"Consome do Tanque " + pump.tankIndex + ": " + pump.productName}>
                <Droplet className="h-2.5 w-2.5 text-blue-500 shrink-0" />
                {pump.productName} (T{pump.tankIndex})
              </span>
            </div>
          </div>
          <span className={"inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold " + current.tone}>
            <Circle className="h-2 w-2 fill-current" />
            {current.label}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">VAZÃO ATUAL</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">
              {number(pump.flow?.value)}
              <span className="ml-1 text-[10px] font-normal text-slate-500">mL/min</span>
            </p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">NÍVEL DO TANQUE</p>
            <p className={"mt-1 text-lg font-bold tabular-nums " + (isLevelCritical ? "text-red-600 font-bold" : isLevelLow ? "text-amber-600" : "text-slate-900")}>
              {number(pump.level?.value, 0)}
              <span className="ml-1 text-[10px] font-normal text-slate-500">%</span>
            </p>
            {estLiters !== undefined && (
              <p className="text-[9px] font-medium text-slate-500 mt-0.5 tabular-nums">
                ~{number(estLiters, 0)} L
              </p>
            )}
          </div>
        </div>

        <div className="mt-2.5 flex items-center justify-between text-xs px-1">
          <span className="text-[10px] font-medium text-slate-500">Volume Dosador:</span>
          <span className="font-bold text-slate-800 tabular-nums">
            {number((Number(pump.total?.value) || 0) / 1000)} L
          </span>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100">
        <div className="h-1 w-full rounded-full overflow-hidden bg-slate-100">
          <div className="h-full" style={{ backgroundColor: current.color, width: "100%" }} />
        </div>
        <p className="mt-1.5 text-[9px] text-slate-400 font-medium">Última leitura: {communication}</p>
      </div>
    </section>
  );
}

function AttentionPanel({ pumps }: { pumps: any[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <AlertCircle className="h-4 w-4 text-amber-600" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Painel de Alertas & Níveis Críticos</h2>
      </div>
      <div className="mt-3 flex-1 space-y-2 overflow-auto max-h-48">
        {pumps.length ? (
          pumps.map((pump) => {
            const levelVal = Number(pump.level?.value);
            const isCriticalLevel = Number.isFinite(levelVal) && levelVal <= 10;
            const isLowLevel = Number.isFinite(levelVal) && levelVal > 10 && levelVal <= 20;
            const st = state(pump.status?.value);
            const isStatusAlert = st.isAttention;

            let desc = "";
            let badgeColor = "bg-amber-50/80 border-amber-200/60 text-amber-900";
            let iconColor = "text-amber-600";

            if (isCriticalLevel) {
              badgeColor = "bg-red-50 border-red-200 text-red-900";
              iconColor = "text-red-600";
              desc = "🚨 NÍVEL CRÍTICO NO TANQUE (" + number(levelVal, 0) + "% ≤ 10%) - Reabastecimento urgente!";
              if (isStatusAlert) desc += " | Status operacional: " + st.label;
            } else if (isLowLevel) {
              desc = "Nível baixo no tanque de origem: " + number(levelVal, 0) + "%";
              if (isStatusAlert) desc += " | Status: " + st.label;
            } else {
              desc = "Status de排出 alerta operacional: " + st.label;
            }

            return (
              <div key={pump.index} className={"flex items-start gap-2.5 rounded-lg border p-2.5 text-xs " + badgeColor}>
                <AlertCircle className={"mt-0.5 h-4 w-4 shrink-0 " + iconColor} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-slate-800">{pump.name}</p>
                    <span className="text-[9px] font-semibold text-slate-600">T{pump.tankIndex} ({pump.productName})</span>
                  </div>
                  <p className="text-[10px] mt-0.5 font-medium">
                    {desc}
                  </p>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex h-full flex-col items-center justify-center py-6 text-center text-slate-400">
            <p className="text-xs font-medium text-emerald-600">✓ Todos os dosadores e tanques operando sem alertas</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default function App() {
  return (
    <TagoIOProvider realtimeStrategy="merge" realtimeMaxRecords={200}>
      <Overview />
    </TagoIOProvider>
  );
}
