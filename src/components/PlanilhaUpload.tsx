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

interface ResolvedName {
  nome: string;
  cnpj: string | null;
  status: "pending" | "resolving" | "fetching" | "done" | "error";
  error?: string;
}

export default function PlanilhaUpload({ onEmpresaFound, onSaveEmpresa }: PlanilhaUploadProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [nomes, setNomes] = useState<ResolvedName[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parseFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();

    if (ext === "csv") {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      // Skip header if it looks like one
      const start = lines[0]?.match(/^(nome|empresa|razao|raz[aã]o)/i) ? 1 : 0;
      return lines.slice(start).map(l => {
        // Take first column if CSV
        const parts = l.split(/[;,\t]/);
        return parts[0].replace(/"/g, "").trim();
      }).filter(Boolean);
    }

    // Excel
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

    if (rows.length === 0) return [];

    // Find the column with company names (first text column)
    const start = rows[0]?.[0]?.toString().match(/^(nome|empresa|razao|raz[aã]o)/i) ? 1 : 0;
    return rows.slice(start).map(r => (r[0] || "").toString().trim()).filter(Boolean);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const names = await parseFile(file);
      if (names.length === 0) return;

      setNomes(names.map(n => ({ nome: n, cnpj: null, status: "pending" })));
      setIsOpen(true);
    } catch (err) {
      console.error("Erro ao ler arquivo:", err);
    }

    // Reset input
    if (fileRef.current) fileRef.current.value = "";
  };

  const processAll = async () => {
    setIsProcessing(true);

    // Process in batches of 20
    const pending = nomes.filter(n => n.status === "pending");
    for (let i = 0; i < pending.length; i += 20) {
      const batch = pending.slice(i, i + 20);
      const batchNames = batch.map(b => b.nome);

      // Update status to resolving
      setNomes(prev => prev.map(n =>
        batchNames.includes(n.nome) ? { ...n, status: "resolving" as const } : n
      ));

      try {
        const { data, error } = await supabase.functions.invoke("resolver-nomes-cnpj", {
          body: { nomes: batchNames },
        });

        if (error || !data?.success) {
          setNomes(prev => prev.map(n =>
            batchNames.includes(n.nome) ? { ...n, status: "error" as const, error: "Falha na resolução" } : n
          ));
          continue;
        }

        const resultados: { nome: string; cnpj: string }[] = data.resultados || [];

        // Update CNPJs
        setNomes(prev => prev.map(n => {
          const match = resultados.find(r =>
            r.nome.toLowerCase() === n.nome.toLowerCase() ||
            n.nome.toLowerCase().includes(r.nome.toLowerCase()) ||
            r.nome.toLowerCase().includes(n.nome.toLowerCase())
          );
          if (match && match.cnpj && match.cnpj !== "desconhecido") {
            return { ...n, cnpj: match.cnpj.replace(/\D/g, ""), status: "fetching" as const };
          }
          if (n.status === "resolving") {
            return { ...n, status: "error" as const, error: "CNPJ não encontrado" };
          }
          return n;
        }));

        // Now fetch each resolved CNPJ
        const resolved = resultados.filter(r => r.cnpj && r.cnpj !== "desconhecido");
        for (const r of resolved) {
          const cnpj = r.cnpj.replace(/\D/g, "");
          if (cnpj.length !== 14) {
            setNomes(prev => prev.map(n =>
              n.cnpj === cnpj ? { ...n, status: "error" as const, error: "CNPJ inválido" } : n
            ));
            continue;
          }

          try {
            const empresa = await fetchCnpj(cnpj);
            onEmpresaFound(empresa);
            onSaveEmpresa(empresa);
            setNomes(prev => prev.map(n =>
              n.cnpj === cnpj ? { ...n, status: "done" as const } : n
            ));
          } catch {
            setNomes(prev => prev.map(n =>
              n.cnpj === cnpj ? { ...n, status: "error" as const, error: "CNPJ não encontrado na RF" } : n
            ));
          }
        }
      } catch (err) {
        console.error("Batch error:", err);
        setNomes(prev => prev.map(n =>
          batchNames.includes(n.nome) ? { ...n, status: "error" as const, error: "Erro de rede" } : n
        ));
      }
    }

    setIsProcessing(false);
  };

  const doneCount = nomes.filter(n => n.status === "done").length;
  const errorCount = nomes.filter(n => n.status === "error").length;
  const progress = nomes.length > 0 ? ((doneCount + errorCount) / nomes.length) * 100 : 0;

  return (
    <div className="space-y-3">
      {/* Upload button */}
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
        <span className="text-xs text-muted-foreground">CSV, XLSX — coluna com nomes de empresas</span>
      </div>

      {/* Processing panel */}
      {isOpen && nomes.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {nomes.length} empresas na planilha
            </CardTitle>
            <div className="flex items-center gap-2">
              {!isProcessing && doneCount === 0 && (
                <Button size="sm" onClick={processAll} className="gap-2">
                  <Loader2 className="h-3 w-3" />
                  Processar Todas
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => { setIsOpen(false); setNomes([]); }}>
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
                <span>{nomes.length - doneCount - errorCount} pendentes</span>
              </div>
            )}
            <div className="max-h-48 overflow-y-auto space-y-1">
              {nomes.map((n, i) => (
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
