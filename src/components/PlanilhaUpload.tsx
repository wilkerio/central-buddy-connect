import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FileText, Upload, Loader2, CheckCircle2, XCircle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchCnpj, type CnpjData } from "@/lib/empresa-api";
import * as XLSX from "xlsx";

interface PlanilhaUploadProps {
  onEmpresaFound: (empresa: CnpjData) => void;
  onSaveEmpresa: (empresa: CnpjData) => void;
}

interface PlanilhaRow {
  nome: string;
  cnpj: string | null;
  status: "pending" | "resolving" | "fetching" | "done" | "error";
  error?: string;
}

const CNPJ_REGEX = /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/;
const CNPJ_HEADER = /^(cnpj|cpf_cnpj|documento|doc)/i;
const NAME_HEADERS = /^(nome|empresa|raz[aã]o|company|name|fantasia|firma|denominacao|denomina[çc][aã]o|fornecedor|cliente|parceiro|contratad[oa])/i;
const NUMBER_LIKE = /^[\d.,R$%]+$/;

function detectColumns(rows: string[][]): { nameCol: number; cnpjCol: number } {
  if (rows.length === 0) return { nameCol: 0, cnpjCol: -1 };
  const header = rows[0];
  const cols = header?.length || 1;

  let nameCol = -1;
  let cnpjCol = -1;

  // 1. Check headers
  for (let c = 0; c < cols; c++) {
    const h = (header[c] || "").toString().trim();
    if (cnpjCol === -1 && CNPJ_HEADER.test(h)) cnpjCol = c;
    if (nameCol === -1 && NAME_HEADERS.test(h)) nameCol = c;
  }

  // 2. Heuristic: scan data rows
  const sample = rows.slice(1, Math.min(20, rows.length));

  if (cnpjCol === -1) {
    for (let c = 0; c < cols; c++) {
      const cnpjCount = sample.filter(r => CNPJ_REGEX.test((r[c] || "").toString().trim())).length;
      if (cnpjCount >= sample.length * 0.5) { cnpjCol = c; break; }
    }
  }

  if (nameCol === -1) {
    const scores = Array(cols).fill(0);
    for (const row of sample) {
      for (let c = 0; c < cols; c++) {
        if (c === cnpjCol) continue;
        const val = (row[c] || "").toString().trim();
        if (!val || CNPJ_REGEX.test(val) || NUMBER_LIKE.test(val)) continue;
        if (val.length >= 3) scores[c] += val.length;
      }
    }
    const best = scores.indexOf(Math.max(...scores));
    nameCol = best >= 0 ? best : 0;
  }

  return { nameCol, cnpjCol };
}

function hasHeaderRow(row: string[]): boolean {
  return row.some(c => {
    const v = (c || "").toString().trim();
    return NAME_HEADERS.test(v) || CNPJ_HEADER.test(v) ||
      /^(id|codigo|c[oó]digo|#|num|n[uú]mero|uf|estado|cidade)/i.test(v);
  });
}

function parseRows(rows: string[][]): PlanilhaRow[] {
  if (rows.length === 0) return [];

  const { nameCol, cnpjCol } = detectColumns(rows);
  const start = hasHeaderRow(rows[0]) ? 1 : 0;

  return rows.slice(start).map(r => {
    const rawCnpj = cnpjCol >= 0 ? (r[cnpjCol] || "").toString().trim() : "";
    const cleanCnpj = rawCnpj.replace(/\D/g, "");
    const hasCnpj = cleanCnpj.length === 14;

    const nome = (r[nameCol] || "").toString().trim();

    if (!nome && !hasCnpj) return null;

    return {
      nome: nome || (hasCnpj ? cleanCnpj : ""),
      cnpj: hasCnpj ? cleanCnpj : null,
      status: hasCnpj ? "fetching" as const : "pending" as const,
    };
  }).filter(Boolean) as PlanilhaRow[];
}

export default function PlanilhaUpload({ onEmpresaFound, onSaveEmpresa }: PlanilhaUploadProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<PlanilhaRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = async (file: File): Promise<string[][]> => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "csv") {
      const text = await file.text();
      return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
        .map(l => l.split(/[;,\t]/).map(c => c.replace(/"/g, "").trim()));
    }
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return (XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][])
      .map(r => r.map(c => (c ?? "").toString().trim()));
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readFile(file);
      const parsed = parseRows(rows);
      if (parsed.length === 0) return;
      setItems(parsed);
      setIsOpen(true);
    } catch (err) {
      console.error("Erro ao ler arquivo:", err);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const processAll = async () => {
    setIsProcessing(true);

    // 1. First, fetch all items that already have CNPJs (direct from Receita)
    const withCnpj = items.filter(n => n.cnpj && n.status === "fetching");
    for (const item of withCnpj) {
      try {
        const empresa = await fetchCnpj(item.cnpj!);
        onEmpresaFound(empresa);
        onSaveEmpresa(empresa);
        setItems(prev => prev.map(n =>
          n.cnpj === item.cnpj ? { ...n, status: "done" as const } : n
        ));
      } catch {
        setItems(prev => prev.map(n =>
          n.cnpj === item.cnpj ? { ...n, status: "error" as const, error: "CNPJ não encontrado na RF" } : n
        ));
      }
    }

    // 2. Then, resolve names without CNPJs via AI (in batches of 20)
    const withoutCnpj = items.filter(n => !n.cnpj && n.status === "pending");
    for (let i = 0; i < withoutCnpj.length; i += 20) {
      const batch = withoutCnpj.slice(i, i + 20);
      const batchNames = batch.map(b => b.nome);

      setItems(prev => prev.map(n =>
        batchNames.includes(n.nome) && n.status === "pending" ? { ...n, status: "resolving" as const } : n
      ));

      try {
        const { data, error } = await supabase.functions.invoke("resolver-nomes-cnpj", {
          body: { nomes: batchNames },
        });

        if (error || !data?.success) {
          setItems(prev => prev.map(n =>
            batchNames.includes(n.nome) && n.status === "resolving"
              ? { ...n, status: "error" as const, error: "Falha na resolução" } : n
          ));
          continue;
        }

        const resultados: { nome: string; cnpj: string }[] = data.resultados || [];

        // Update and fetch resolved CNPJs
        for (const item of batch) {
          const match = resultados.find(r =>
            r.nome.toLowerCase() === item.nome.toLowerCase() ||
            item.nome.toLowerCase().includes(r.nome.toLowerCase()) ||
            r.nome.toLowerCase().includes(item.nome.toLowerCase())
          );

          if (!match || !match.cnpj || match.cnpj === "desconhecido") {
            setItems(prev => prev.map(n =>
              n.nome === item.nome && n.status === "resolving"
                ? { ...n, status: "error" as const, error: "CNPJ não encontrado" } : n
            ));
            continue;
          }

          const cnpj = match.cnpj.replace(/\D/g, "");
          if (cnpj.length !== 14) {
            setItems(prev => prev.map(n =>
              n.nome === item.nome ? { ...n, status: "error" as const, error: "CNPJ inválido" } : n
            ));
            continue;
          }

          setItems(prev => prev.map(n =>
            n.nome === item.nome ? { ...n, cnpj, status: "fetching" as const } : n
          ));

          try {
            const empresa = await fetchCnpj(cnpj);
            onEmpresaFound(empresa);
            onSaveEmpresa(empresa);
            setItems(prev => prev.map(n =>
              n.nome === item.nome ? { ...n, status: "done" as const } : n
            ));
          } catch {
            setItems(prev => prev.map(n =>
              n.nome === item.nome ? { ...n, status: "error" as const, error: "CNPJ não encontrado na RF" } : n
            ));
          }
        }
      } catch (err) {
        console.error("Batch error:", err);
        setItems(prev => prev.map(n =>
          batchNames.includes(n.nome) && n.status === "resolving"
            ? { ...n, status: "error" as const, error: "Erro de rede" } : n
        ));
      }
    }

    setIsProcessing(false);
  };

  const doneCount = items.filter(n => n.status === "done").length;
  const errorCount = items.filter(n => n.status === "error").length;
  const withCnpjCount = items.filter(n => n.cnpj).length;
  const withoutCnpjCount = items.filter(n => !n.cnpj).length;
  const progress = items.length > 0 ? ((doneCount + errorCount) / items.length) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleFile}
          className="hidden"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          className="gap-2"
        >
          <Upload className="h-4 w-4" />
          Importar Planilha
        </Button>
        <span className="text-xs text-muted-foreground">CSV, XLSX — com nomes e/ou CNPJs</span>
      </div>

      {isOpen && items.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {items.length} empresas
              {withCnpjCount > 0 && (
                <Badge variant="secondary" className="text-[10px]">{withCnpjCount} com CNPJ</Badge>
              )}
              {withoutCnpjCount > 0 && (
                <Badge variant="outline" className="text-[10px]">{withoutCnpjCount} só nome</Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              {!isProcessing && doneCount === 0 && (
                <Button size="sm" onClick={processAll} className="gap-2">
                  <Loader2 className="h-3 w-3" />
                  Processar Todas
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => { setIsOpen(false); setItems([]); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            {isProcessing && <Progress value={progress} className="h-2" />}
            {(isProcessing || doneCount > 0 || errorCount > 0) && (
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="text-green-600">✓ {doneCount} ok</span>
                <span className="text-destructive">✗ {errorCount} erros</span>
                <span>{items.length - doneCount - errorCount} pendentes</span>
              </div>
            )}
            <div className="max-h-48 overflow-y-auto space-y-1">
              {items.map((n, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-border/50 last:border-0">
                  {n.status === "done" && <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />}
                  {n.status === "error" && <XCircle className="h-3 w-3 text-destructive shrink-0" />}
                  {(n.status === "resolving" || n.status === "fetching") && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
                  {n.status === "pending" && <div className="h-3 w-3 rounded-full border border-muted-foreground/30 shrink-0" />}
                  <span className="truncate flex-1">{n.nome}</span>
                  {n.cnpj && <Badge variant="outline" className="text-[10px] font-mono">{n.cnpj}</Badge>}
                  {n.error && <span className="text-destructive text-[10px]">{n.error}</span>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
