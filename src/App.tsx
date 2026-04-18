/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter, Line, ErrorBar
} from 'recharts';
import { 
  Plus, Trash2, Calculator, BarChart3, Settings2, Info, ChevronRight, Download, RefreshCw, AlertCircle
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// —— 数据结构定义 ——
interface CalibrationPoint {
  id: string;
  m: string; // 质量 (g)
  u: string; // 电压 U (mV)
  u_prime: string; // 电压 U' (mV)
}

interface TestDataPoint {
  id: string;
  u1: string; // 拉断前电压 (mV)
  u2: string; // 拉断后电压 (mV)
}

interface DiameterMeasurement {
  id: string;
  d1: string; // 外径
  d2: string; // 内径
}

// —— 校验规则 ——
const VALIDATION_RULES = {
  m: { min: 0, max: 100, label: '质量' },
  u: { min: -1000, max: 1000, label: '电压' },
  d: { min: 10, max: 200, label: '直径' },
  temp: { min: 0, max: 100, label: '液体温度' },
  g: { min: 9, max: 11, label: '重力加速度' }
};

// —— 水的表面张力参考表 (20°C - 30°C) —— 单位: mN/m
const ST_REF_TABLE: Record<number, number> = {
  20: 72.75, 21: 72.59, 22: 72.44, 23: 72.28, 24: 72.13,
  25: 71.97, 26: 71.82, 27: 71.66, 28: 71.50, 29: 71.35, 30: 71.18
};

export default function App() {
  // —— 状态管理 ——
  const [calibData, setCalibData] = useState<CalibrationPoint[]>([
    { id: '1', m: '0.00', u: '0.00', u_prime: '0.00' },
    { id: '2', m: '1.00', u: '10.20', u_prime: '10.30' },
    { id: '3', m: '2.00', u: '20.50', u_prime: '20.60' },
    { id: '4', m: '3.00', u: '30.80', u_prime: '30.90' },
    { id: '5', m: '4.00', u: '41.10', u_prime: '41.20' },
  ]);

  const [testData, setTestData] = useState<TestDataPoint[]>([
    { id: '1', u1: '450.2', u2: '400.1' },
    { id: '2', u1: '451.1', u2: '401.0' },
    { id: '3', u1: '449.8', u2: '399.7' }
  ]);

  const [diameterData, setDiameterData] = useState<DiameterMeasurement[]>([
    { id: '1', d1: '33.10', d2: '32.10' },
    { id: '2', d1: '33.12', d2: '32.12' },
    { id: '3', d1: '33.08', d2: '32.08' }
  ]);

  const [temp, setTemp] = useState('25');   // 温度 (°C)
  const [g, setG] = useState('9.80');       // 重力加速度 (m/s^2)

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'calib' | 'test' | 'results'>('calib');
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // —— 校验逻辑 ——
  const getFieldError = (val: string, type: keyof typeof VALIDATION_RULES) => {
    if (val === '') return '';
    const num = parseFloat(val);
    if (isNaN(num)) return '请输入有效数字';
    const rule = VALIDATION_RULES[type];
    if (num < rule.min || num > rule.max) {
      return `${rule.label}需在 ${rule.min} 到 ${rule.max} 之间`;
    }
    return '';
  };

  const handleFieldChange = (id: string, field: string, value: string, type: keyof typeof VALIDATION_RULES) => {
    const error = getFieldError(value, type);
    const errorKey = `${id}-${field}`;
    setFieldErrors(prev => {
      const newErrors = { ...prev };
      if (error) newErrors[errorKey] = error;
      else delete newErrors[errorKey];
      return newErrors;
    });
  };

  // —— 逻辑计算：传感器定标 ——
  const calibResult = useMemo(() => {
    const validPoints = calibData.filter(p => p.m !== '' && p.u !== '' && p.u_prime !== '');
    if (validPoints.length < 2) return null;

    const n = validPoints.length;
    const x = validPoints.map(p => parseFloat(p.m));
    const y = validPoints.map(p => (parseFloat(p.u) + parseFloat(p.u_prime)) / 2);

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
        sumX += x[i];
        sumY += y[i];
        sumXY += x[i] * y[i];
        sumX2 += x[i] * x[i];
        sumY2 += y[i] * y[i];
    }

    const b = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const a = (sumY - b * sumX) / n;
    
    // 相关系数 r
    const rNumerator = n * sumXY - sumX * sumY;
    const rDenominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    const r = rDenominator === 0 ? 0 : rNumerator / rDenominator;
    
    // 灵敏度 B = b / (g * 10^-3) 如果 m 是克，F = (m/1000) * g
    // b = ΔU / Δm (mV/g)
    // B = ΔU / ΔF = ΔU / (Δm * g / 1000) = (b * 1000) / g (mV/N)
    const sensitivity = (b * 1000) / parseFloat(g);

    return { 
      a, b, r, sensitivity, 
      points: validPoints.map((p, i) => {
        const uVal = parseFloat(p.u);
        const uPrimeVal = parseFloat(p.u_prime);
        const errorY = Math.max(0.1, Math.abs(uVal - uPrimeVal) / 2); // 至少保留 0.1mV 的基本不确定度
        return { 
          x: x[i], 
          y: y[i], 
          fit: a + b * x[i],
          errorY 
        };
      }) 
    };
  }, [calibData, g]);

  // —— 逻辑计算：表面张力 ——
  const finalResult = useMemo(() => {
    if (!calibResult) return null;

    // 1. 计算直径平均值
    const validDiams = diameterData.filter(p => p.d1 !== '' && p.d2 !== '');
    if (validDiams.length === 0) return null;
    const avgD1 = validDiams.reduce((sum, p) => sum + parseFloat(p.d1), 0) / validDiams.length;
    const avgD2 = validDiams.reduce((sum, p) => sum + parseFloat(p.d2), 0) / validDiams.length;
    
    // 2. 计算电压差平均值
    const validTests = testData.filter(p => p.u1 !== '' && p.u2 !== '');
    if (validTests.length === 0) return null;

    const deltaUs = validTests.map(p => parseFloat(p.u1) - parseFloat(p.u2));
    const avgDeltaU = deltaUs.reduce((a, b) => a + b, 0) / deltaUs.length;

    // σ = ΔU / (B * π * (D1 + D2))
    // 注意单位：ΔU (mV), B (mV/N), D1/D2 (mm -> m)
    const B = calibResult.sensitivity;
    const dSumMeters = (avgD1 + avgD2) / 1000;
    
    const sigma = avgDeltaU / (B * Math.PI * dSumMeters); // 单位：N/m
    const sigmaMilli = sigma * 1000; // 单位：mN/m

    // 相对误差
    const tNum = Math.round(parseFloat(temp));
    const sigmaRef = ST_REF_TABLE[tNum] || ST_REF_TABLE[25];
    const relError = Math.abs(sigmaMilli - sigmaRef) / sigmaRef * 100;

    // 过程量
    const avgU1 = validTests.reduce((a, b) => a + parseFloat(b.u1), 0) / validTests.length;
    const avgU2 = validTests.reduce((a, b) => a + parseFloat(b.u2), 0) / validTests.length;

    return { 
      avgU1, avgU2, avgDeltaU, 
      avgD1, avgD2,
      sigma, sigmaMilli, sigmaRef, relError 
    };
  }, [calibResult, testData, diameterData, temp]);


  // —— 操作逻辑 ——
  const addCalibRow = () => setCalibData([...calibData, { id: Date.now().toString(), m: '', u: '', u_prime: '' }]);
  const removeCalibRow = (id: string) => setCalibData(calibData.filter(p => p.id !== id));
  
  const addTestRow = () => setTestData([...testData, { id: Date.now().toString(), u1: '', u2: '' }]);
  const removeTestRow = (id: string) => setTestData(testData.filter(p => p.id !== id));

  const addDiameterRow = () => setDiameterData([...diameterData, { id: Date.now().toString(), d1: '', d2: '' }]);
  const removeDiameterRow = (id: string) => setDiameterData(diameterData.filter(p => p.id !== id));

  const handleReset = () => {
    if (window.confirm('确定要清空所有实验数据吗？')) {
      setCalibData([{ id: '1', m: '', u: '', u_prime: '' }]);
      setTestData([{ id: '1', u1: '', u2: '' }]);
      setDiameterData([{ id: '1', d1: '', d2: '' }]);
      setTemp('');
      setG('');
      setFieldErrors({});
      setActiveTab('calib');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text-main font-sans">
      {/* Header */}
      <header className="bg-white px-4 lg:px-8 border-b border-border flex flex-col sm:flex-row justify-between items-center py-4 sm:py-0 sm:h-[70px] shrink-0 gap-3 sm:gap-0">
        <h1 className="text-[1.125rem] lg:text-[1.25rem] font-bold text-primary flex items-center gap-2">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          <span className="hidden xs:inline">液体表面张力分析系统</span>
          <span className="xs:hidden">张力分析系统</span>
          <span className="text-[0.7rem] opacity-50 font-normal ml-1">v1.2</span>
        </h1>
        <div className="bg-primary-light text-primary px-3 py-1 rounded-full text-[0.7rem] sm:text-[0.75rem] font-semibold whitespace-nowrap">
          实验状态: 数据处理中
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-[320px_1fr_300px] gap-4 lg:gap-6 p-4 lg:p-6 flex-1 overflow-auto max-w-[1400px] mx-auto w-full mb-[120px] lg:mb-0">
        
        {/* Section 1: Calibration */}
        <section className={cn(
          "card lg:max-h-[calc(100vh-120px)] overflow-hidden",
          activeTab !== 'calib' && "hidden lg:flex"
        )}>
          <div className="card-header px-4 py-3 sm:px-4 sm:py-3">
            <span className="truncate">传感器定标数据 (Module I)</span>
            {calibResult && (
              <span className="text-accent font-mono text-[0.7rem] sm:text-[0.75rem] shrink-0 ml-2">r={calibResult.r.toFixed(4)}</span>
            )}
          </div>
          <div className="card-content p-3 sm:p-4 flex flex-col gap-4 overflow-hidden">
            <div className="overflow-auto flex-1 -mx-3 sm:mx-0">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="table-header w-10 text-center text-[0.7rem] uppercase">#</th>
                    <th className="table-header min-w-[55px] sm:min-w-[70px]">m (g)</th>
                    <th className="table-header min-w-[70px]">U (mV)</th>
                    <th className="table-header min-w-[70px]">U' (mV)</th>
                    <th className="table-header min-w-[60px]">y (mV)</th>
                    <th className="table-header w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {calibData.map((row, idx) => (
                    <tr key={row.id} className={cn(focusedId === row.id && "input-focus-row")}>
                      <td className="table-cell text-center text-text-muted">{idx + 1}</td>
                      <td className="table-cell">
                        <div className="relative group">
                          <input 
                            type="number" 
                            inputMode="decimal"
                            value={row.m} 
                            onFocus={() => setFocusedId(row.id)}
                            onBlur={() => setFocusedId(null)}
                            onChange={e => {
                              const val = e.target.value;
                              handleFieldChange(row.id, 'm', val, 'm');
                              setCalibData(calibData.map(p => p.id === row.id ? {...p, m: val} : p));
                            }}
                            className={cn(
                              "w-full bg-transparent outline-none transition-colors px-0.5",
                              fieldErrors[`${row.id}-m`] && "text-red-500"
                            )}
                            placeholder="0.00"
                          />
                          {fieldErrors[`${row.id}-m`] && (
                            <div className="absolute left-0 -top-8 bg-red-500 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-nowrap pointer-events-none shadow-lg">
                              {fieldErrors[`${row.id}-m`]}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="table-cell">
                        <div className="relative group">
                          <input 
                            type="number" 
                            inputMode="decimal"
                            value={row.u} 
                            onFocus={() => setFocusedId(row.id)}
                            onBlur={() => setFocusedId(null)}
                            onChange={e => {
                              const val = e.target.value;
                              handleFieldChange(row.id, 'u', val, 'u');
                              setCalibData(calibData.map(p => p.id === row.id ? {...p, u: val} : p));
                            }}
                            className={cn(
                              "w-full bg-transparent outline-none transition-colors px-0.5",
                              fieldErrors[`${row.id}-u`] && "text-red-500"
                            )}
                            placeholder="0.0"
                          />
                          {fieldErrors[`${row.id}-u`] && (
                            <div className="absolute left-0 -top-8 bg-red-500 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-nowrap pointer-events-none shadow-lg">
                              {fieldErrors[`${row.id}-u`]}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="table-cell">
                        <div className="relative group">
                          <input 
                            type="number" 
                            inputMode="decimal"
                            value={row.u_prime} 
                            onFocus={() => setFocusedId(row.id)}
                            onBlur={() => setFocusedId(null)}
                            onChange={e => {
                              const val = e.target.value;
                              handleFieldChange(row.id, 'u_prime', val, 'u');
                              setCalibData(calibData.map(p => p.id === row.id ? {...p, u_prime: val} : p));
                            }}
                            className={cn(
                              "w-full bg-transparent outline-none transition-colors px-0.5",
                              fieldErrors[`${row.id}-u_prime`] && "text-red-500"
                            )}
                            placeholder="0.0"
                          />
                          {fieldErrors[`${row.id}-u_prime`] && (
                            <div className="absolute left-0 -top-8 bg-red-500 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-nowrap pointer-events-none shadow-lg">
                              {fieldErrors[`${row.id}-u_prime`]}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="table-cell text-text-muted">
                        {row.u && row.u_prime ? ((parseFloat(row.u) + parseFloat(row.u_prime)) / 2).toFixed(2) : '-'}
                      </td>
                      <td className="table-cell">
                        <button onClick={() => removeCalibRow(row.id)} className="text-slate-300 hover:text-red-500 transition-colors p-1">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button 
                onClick={addCalibRow} 
                className="w-full py-2 text-[0.7rem] text-primary hover:bg-primary-light transition-colors flex items-center justify-center gap-1 border-t border-[#f9fafb]"
              >
                <Plus size={12} /> 添加定标行
              </button>
            </div>

            <div className="h-[220px] w-full bg-[#f8fafc] rounded-lg p-2 border border-border border-dashed relative flex items-center justify-center shrink-0">
              {calibResult ? (
                <div className="w-full h-full relative">
                  <div className="absolute inset-0 flex items-center justify-center opacity-10">
                    <div className="w-[80%] h-[2px] bg-primary rotate-[-15deg]"></div>
                  </div>
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 20, right: 20, bottom: 35, left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis 
                        type="number" 
                        dataKey="x" 
                        name="质量" 
                        unit="g" 
                        fontSize={10} 
                        tick={{ fill: '#64748b' }}
                        label={{ value: '质量 m (g)', position: 'insideBottom', offset: -25, fontSize: 10, fill: '#64748b' }}
                      />
                      <YAxis 
                        type="number" 
                        dataKey="y" 
                        name="电压" 
                        unit="mV" 
                        fontSize={10} 
                        tick={{ fill: '#64748b' }}
                        label={{ value: '电压 y (mV)', angle: -90, position: 'insideLeft', offset: 10, fontSize: 10, fill: '#64748b' }}
                      />
                      <Tooltip 
                        contentStyle={{ fontSize: '10px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                        cursor={{ strokeDasharray: '3 3' }}
                      />
                      <Scatter name="数据点" data={calibResult.points} fill="var(--color-primary)">
                        <ErrorBar dataKey="errorY" direction="y" stroke="var(--color-primary)" strokeWidth={1} width={4} />
                      </Scatter>
                      <Scatter data={calibResult.points} line={{ stroke: 'var(--color-primary)', strokeWidth: 1.5 }} shape={() => null} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <span className="text-[0.7rem] text-text-muted">最小二乘法拟合曲线</span>
              )}
            </div>
          </div>
        </section>

        {/* Section 2: Parameters and Experiment */}
        <section className={cn(
          "card lg:max-h-[calc(100vh-120px)]",
          activeTab !== 'test' && "hidden lg:flex"
        )}>
          <div className="card-header px-4 py-3 sm:px-4 sm:py-3 text-[0.875rem]">实验测量数据 (Module II & III)</div>
          <div className="card-content p-4 sm:p-5 flex flex-col gap-5 overflow-auto">
            
            {/* Global Params & Diameter Table */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[0.7rem] text-text-muted block font-bold uppercase tracking-tight">液体温度 T' (℃)</label>
                  <input 
                    type="number" 
                    inputMode="decimal"
                    value={temp} 
                    onChange={e => {
                      const val = e.target.value;
                      handleFieldChange('global', 'temp', val, 'temp');
                      setTemp(val);
                    }} 
                    className={cn(
                      "scientific-input",
                      fieldErrors['global-temp'] && "border-red-500 ring-red-500/20 ring-2"
                    )} 
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[0.7rem] text-text-muted block font-bold uppercase tracking-tight">重力加速度 g (m/s²)</label>
                  <input 
                    type="number" 
                    inputMode="decimal"
                    value={g} 
                    onChange={e => {
                      const val = e.target.value;
                      handleFieldChange('global', 'g', val, 'g');
                      setG(val);
                    }} 
                    className={cn(
                      "scientific-input",
                      fieldErrors['global-g'] && "border-red-500 ring-red-500/20 ring-2"
                    )} 
                  />
                </div>
              </div>

              {/* Diameter Measurements Table */}
              <div className="space-y-2 border-t pt-4">
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[0.75rem] text-text-muted font-bold">环径多次测量 (mm)</label>
                </div>
                <table className="w-full text-[0.75rem]">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="p-1 px-2 border-b border-border text-left">#</th>
                      <th className="p-1 px-2 border-b border-border text-left">外径 D₁</th>
                      <th className="p-1 px-2 border-b border-border text-left">内径 D₂</th>
                      <th className="p-1 px-2 border-b border-border w-6"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {diameterData.map((row, idx) => (
                      <tr key={row.id}>
                        <td className="p-1 px-2 border-b border-slate-50 text-text-muted italic">{idx + 1}</td>
                        <td className="p-1 px-2 border-b border-slate-50">
                          <input 
                            type="number" 
                            inputMode="decimal"
                            value={row.d1} 
                            onChange={e => {
                              const val = e.target.value;
                              handleFieldChange(row.id, 'd1', val, 'd');
                              setDiameterData(diameterData.map(p => p.id === row.id ? {...p, d1: val} : p));
                            }} 
                            className="w-full bg-transparent outline-none font-mono"
                            placeholder="0.00"
                          />
                        </td>
                        <td className="p-1 px-2 border-b border-slate-50">
                          <input 
                            type="number" 
                            inputMode="decimal"
                            value={row.d2} 
                            onChange={e => {
                              const val = e.target.value;
                              handleFieldChange(row.id, 'd2', val, 'd');
                              setDiameterData(diameterData.map(p => p.id === row.id ? {...p, d2: val} : p));
                            }} 
                            className="w-full bg-transparent outline-none font-mono"
                            placeholder="0.00"
                          />
                        </td>
                        <td className="p-1 px-2 border-b border-slate-50">
                          <button onClick={() => removeDiameterRow(row.id)} className="text-slate-300 hover:text-red-500">
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button 
                  onClick={addDiameterRow}
                  className="w-full py-1.5 border border-dashed border-border rounded text-[0.7rem] text-text-muted hover:border-primary hover:text-primary transition-colors flex items-center justify-center gap-1"
                >
                  <Plus size={12} /> 添加直径测量
                </button>
              </div>

              {/* Data Statistics / Averages Display */}
              <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <BarChart3 size={14} className="text-primary" />
                  <span className="text-[0.7rem] font-bold text-text-muted uppercase tracking-wider">当前测量项目均值统计</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <div className="flex justify-between items-center bg-white px-2 py-1.5 rounded border border-slate-100 shadow-sm">
                    <span className="text-[0.65rem] text-text-muted">外径 D₁</span>
                    <span className="text-[0.75rem] font-mono font-bold text-primary">{finalResult ? finalResult.avgD1.toFixed(2) : '-'} <span className="text-[9px] font-normal text-text-muted">mm</span></span>
                  </div>
                  <div className="flex justify-between items-center bg-white px-2 py-1.5 rounded border border-slate-100 shadow-sm">
                    <span className="text-[0.65rem] text-text-muted">内径 D₂</span>
                    <span className="text-[0.75rem] font-mono font-bold text-primary">{finalResult ? finalResult.avgD2.toFixed(2) : '-'} <span className="text-[9px] font-normal text-text-muted">mm</span></span>
                  </div>
                  <div className="flex justify-between items-center bg-white px-2 py-1.5 rounded border border-slate-100 shadow-sm">
                    <span className="text-[0.65rem] text-text-muted">拉断前 U₁</span>
                    <span className="text-[0.75rem] font-mono font-bold text-primary">{finalResult ? finalResult.avgU1.toFixed(2) : '-'} <span className="text-[9px] font-normal text-text-muted">mV</span></span>
                  </div>
                  <div className="flex justify-between items-center bg-white px-2 py-1.5 rounded border border-slate-100 shadow-sm">
                    <span className="text-[0.65rem] text-text-muted">拉断后 U₂</span>
                    <span className="text-[0.75rem] font-mono font-bold text-primary">{finalResult ? finalResult.avgU2.toFixed(2) : '-'} <span className="text-[9px] font-normal text-text-muted">mV</span></span>
                  </div>
                </div>
                {finalResult && (
                  <div className="pt-1 flex justify-center">
                    <div className="text-[0.65rem] text-text-muted bg-primary/5 px-3 py-0.5 rounded-full border border-primary/10">
                      有效差值 ΔŪ: <span className="font-bold text-primary">{finalResult.avgDeltaU.toFixed(2)} mV</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="h-[1px] bg-border my-1"></div>

            {/* Test Voltage Data Table */}
            <div className="flex-1 overflow-auto -mx-4 sm:mx-0 space-y-2">
              <label className="text-[0.75rem] text-text-muted font-bold block px-4 sm:px-0">拉断电压测量 (mV)</label>
              <table className="w-full text-sm border-collapse min-w-[400px] sm:min-w-0">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="table-header">拉断前瞬间值 U1 (mV)</th>
                    <th className="table-header">拉断后稳定值 U2 (mV)</th>
                    <th className="table-header text-right">ΔU (mV)</th>
                    <th className="table-header w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {testData.map((row) => (
                    <tr key={row.id} className={cn(focusedId === row.id && "input-focus-row")}>
                      <td className="table-cell">
                        <div className="relative group">
                          <input 
                            type="number" 
                            inputMode="decimal"
                            value={row.u1} 
                            onFocus={() => setFocusedId(row.id)}
                            onBlur={() => setFocusedId(null)}
                            onChange={e => {
                              const val = e.target.value;
                              handleFieldChange(row.id, 'u1', val, 'u');
                              setTestData(testData.map(p => p.id === row.id ? {...p, u1: val} : p));
                            }}
                            className={cn(
                              "w-full bg-transparent outline-none transition-colors",
                              fieldErrors[`${row.id}-u1`] && "text-red-500"
                            )}
                            placeholder="0.0"
                          />
                          {fieldErrors[`${row.id}-u1`] && (
                            <div className="absolute left-0 -top-8 bg-red-500 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-nowrap pointer-events-none shadow-lg">
                              {fieldErrors[`${row.id}-u1`]}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="table-cell">
                        <div className="relative group">
                          <input 
                            type="number" 
                            inputMode="decimal"
                            value={row.u2} 
                            onFocus={() => setFocusedId(row.id)}
                            onBlur={() => setFocusedId(null)}
                            onChange={e => {
                              const val = e.target.value;
                              handleFieldChange(row.id, 'u2', val, 'u');
                              setTestData(testData.map(p => p.id === row.id ? {...p, u2: val} : p));
                            }}
                            className={cn(
                              "w-full bg-transparent outline-none transition-colors",
                              fieldErrors[`${row.id}-u2`] && "text-red-500"
                            )}
                            placeholder="0.0"
                          />
                          {fieldErrors[`${row.id}-u2`] && (
                            <div className="absolute left-0 -top-8 bg-red-500 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-nowrap pointer-events-none shadow-lg">
                              {fieldErrors[`${row.id}-u2`]}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="table-cell text-right text-text-muted">
                        {row.u1 && row.u2 ? (parseFloat(row.u1) - parseFloat(row.u2)).toFixed(2) : '-'}
                      </td>
                      <td className="table-cell">
                        <button onClick={() => removeTestRow(row.id)} className="text-slate-300 hover:text-red-500 transition-colors p-2">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button 
                onClick={addTestRow} 
                className="w-full py-3 mt-4 text-[0.85rem] font-semibold text-primary border border-primary/20 rounded-md hover:bg-primary-light transition-all flex items-center justify-center gap-1 shadow-sm active:scale-[0.98]"
              >
                <Plus size={16} /> 添加测量记录
              </button>
            </div>
          </div>
          
          <div className="p-4 bg-white border-t border-border flex gap-3">
            <button onClick={handleReset} className="btn-secondary">重置数据</button>
            <button onClick={() => setActiveTab('results')} className="btn-primary">查看计算结论</button>
          </div>
        </section>

        {/* Section 3: Final Results */}
        <section className={cn(
          "card lg:max-h-[calc(100vh-120px)]",
          activeTab !== 'results' && "hidden lg:flex"
        )}>
          <div className="card-header px-4 py-3">计算结果 (Module IV)</div>
          <div className="card-content p-5 sm:p-6 flex flex-col gap-4">
            
            {/* Metrics */}
            <div className="space-y-3 mt-2">
              <div className="metric">
                <span className="text-[0.75rem] sm:text-[0.8125rem]">定标斜率 b</span>
                <span className="text-[0.75rem] sm:text-[0.8125rem]">{calibResult ? calibResult.b.toFixed(4) : '-'} mV/g</span>
              </div>
              <div className="metric">
                <span className="text-[0.75rem] sm:text-[0.8125rem]">灵敏度 B</span>
                <span className="text-[0.75rem] sm:text-[0.8125rem]">{calibResult ? calibResult.sensitivity.toFixed(2) : '-'} mV/N</span>
              </div>
              <div className="metric">
                <span className="text-[0.75rem] sm:text-[0.8125rem]">标准值 σ₀</span>
                <span className="text-[0.75rem] sm:text-[0.8125rem]">{finalResult ? finalResult.sigmaRef.toFixed(2) : '-'}</span>
              </div>
            </div>

            {/* Sigma Result */}
            <div className="my-6 lg:my-8 text-center">
              <label className="text-[0.7rem] sm:text-[0.75rem] text-text-muted block mb-2">测量表面张力系数 σ</label>
              <div className="result-box py-3 sm:py-4">
                <span className="result-val text-[1.25rem] sm:text-[1.5rem]">{finalResult ? finalResult.sigmaMilli.toFixed(2) : '0.00'}</span>
                <span className="text-[0.7rem] sm:text-[0.75rem] text-text-muted ml-1">mN/m</span>
              </div>
            </div>

            {/* Error Analysis */}
            <div className="mt-2">
              <div className="metric">
                <span>相对误差 E</span>
                <span className={cn(
                  finalResult && finalResult.relError < 5 ? "text-accent" : "text-amber-500"
                )}>
                  {finalResult ? finalResult.relError.toFixed(2) : '0.00'}%
                </span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full mt-2 overflow-hidden shadow-inner">
                <div 
                  className="h-full bg-accent transition-all duration-700 ease-out"
                  style={{ width: `${finalResult ? Math.min(100, finalResult.relError) : 0}%` }}
                />
              </div>
            </div>

            <div className="mt-2 text-[0.7rem] text-text-muted flex justify-between">
              <span>状态: 已基于所有有效测量记录自动同步均值</span>
              <span className="opacity-70">水温: {temp}℃</span>
            </div>
          </div>
        </section>
      </main>

      {/* Mobile Sticky Summary FAB */}
      {finalResult && activeTab !== 'results' && (
        <div className="sticky-bottom-summary">
          <div className="flex flex-col">
            <span className="text-[10px] text-text-muted uppercase font-bold tracking-tighter">当前表面张力 σ</span>
            <div className="flex items-baseline gap-1">
              <span className="text-[1.125rem] font-mono font-bold text-primary">{finalResult.sigmaMilli.toFixed(2)}</span>
              <span className="text-[0.6rem] text-text-muted">mN/m</span>
            </div>
          </div>
          <button 
            onClick={() => setActiveTab('results')}
            className="bg-primary text-white p-2 rounded-full shadow-lg active:scale-95 transition-transform"
          >
            <Calculator size={18} />
          </button>
        </div>
      )}

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-border grid grid-cols-3 lg:hidden h-[60px] z-50">
        <button onClick={() => setActiveTab('calib')} className={cn("mobile-tab-btn", activeTab === 'calib' && "active")}>
          <BarChart3 size={18} />
          <span>传感器定标</span>
        </button>
        <button onClick={() => setActiveTab('test')} className={cn("mobile-tab-btn", activeTab === 'test' && "active")}>
          <RefreshCw size={18} />
          <span>实验测量</span>
        </button>
        <button onClick={() => setActiveTab('results')} className={cn("mobile-tab-btn", activeTab === 'results' && "active")}>
          <Calculator size={18} />
          <span>计算结论</span>
        </button>
      </nav>
    </div>
  );
}
