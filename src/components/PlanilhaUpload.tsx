import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { FileText, Upload, Loader2, CheckCircle2, XCircle, X, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchCnpj, type CnpjData } from "@/lib/empresa-api";
import * as XLSX from "xlsx";

interface PlanilhaUploadProps {
  onEmpresaFound: (empresa: CnpjData) => void;
  onSaveEmpresa: (empresa: CnpjData) => void;
  onBatchComplete?: () => void;
}

interface PlanilhaRow {
  nome: string;
  cnpj: string | null;
  telefone: string | null;
  email: string | null;
  contato_nome: string | null;
  cargo: string | null;
  dados_extras: Record<string, string>;
  status: "pending" | "resolving" | "fetching" | "done" | "error";
  error?: string;
}

const CNPJ_REGEX = /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/;
const CNPJ_HEADER = /^(cnpj|cpf_cnpj|documento|doc)/i;
const NAME_HEADERS = /^(nome|empresa|raz[aã]o|company|name|fantasia|firma|denominacao|denomina[çc][aã]o|fornecedor|cliente|parceiro|contratad[oa])/i;
const PHONE_HEADERS = /^(telefone|tel|fone|phone|celular|cel|whatsapp|wpp|contato|ddd)/i;
const EMAIL_HEADERS = /^(email|e-mail|mail|correio)/i;
const CONTACT_NAME_HEADERS = /^(responsavel|responsável|contato_nome|nome_contato|pessoa|representante|gestor)/i;
const CARGO_HEADERS = /^(cargo|funcao|função|posicao|posição|titulo|título|role|position)/i;
const NUMBER_LIKE = /^[\d.,R$%]+$/;
const PHONE_LIKE = /^[\d\s()+\-.]{8,20}$/;

interface DetectedColumns {
  nameCol: number;
  cnpjCol: number;
  phoneCol: number;
  emailCol: number;
  contactNameCol: number;
  cargoCol: number;
  extraCols: { index: number; header: string }[];
}

function detectColumns(rows: string[][]): DetectedColumns {
  if (rows.length === 0) return { nameCol: 0, cnpjCol: -1, phoneCol: -1, emailCol: -1, contactNameCol: -1, cargoCol: -1, extraCols: [] };
  const header = rows[0];
  const cols = header?.length || 1;

  let nameCol = -1, cnpjCol = -1, phoneCol = -1, emailCol = -1, contactNameCol = -1, cargoCol = -1;
  const usedCols = new Set<number>();

  // 1. Check headers
  for (let c = 0; c < cols; c++) {
    const h = (header[c] || "").toString().trim();
    if (cnpjCol === -1 && CNPJ_HEADER.test(h)) { cnpjCol = c; usedCols.add(c); }
    if (nameCol === -1 && NAME_HEADERS.test(h)) { nameCol = c; usedCols.add(c); }
    if (phoneCol === -1 && PHONE_HEADERS.test(h)) { phoneCol = c; usedCols.add(c); }
    if (emailCol === -1 && EMAIL_HEADERS.test(h)) { emailCol = c; usedCols.add(c); }
    if (contactNameCol === -1 && CONTACT_NAME_HEADERS.test(h)) { contactNameCol = c; usedCols.add(c); }
    if (cargoCol === -1 && CARGO_HEADERS.test(h)) { cargoCol = c; usedCols.add(c); }
  }

  // 2. Heuristic: scan data rows for CNPJ and phone
  const sample = rows.slice(1, Math.min(20, rows.length));

  if (cnpjCol === -1) {
    for (let c = 0; c < cols; c++) {
      const cnpjCount = sample.filter(r => CNPJ_REGEX.test((r[c] || "").toString().trim())).length;
      if (cnpjCount >= sample.length * 0.5) { cnpjCol = c; usedCols.add(c); break; }
    }
  }

  if (phoneCol === -1) {
    for (let c = 0; c < cols; c++) {
      if (usedCols.has(c)) continue;
      const phoneCount = sample.filter(r => PHONE_LIKE.test((r[c] || "").toString().trim())).length;
      if (phoneCount >= sample.length * 0.4) { phoneCol = c; usedCols.add(c); break; }
    }
  }

  if (emailCol === -1) {
    for (let c = 0; c < cols; c++) {
      if (usedCols.has(c)) continue;
      const emailCount = sample.filter(r => (r[c] || "").toString().includes("@")).length;
      if (emailCount >= sample.length * 0.3) { emailCol = c; usedCols.add(c); break; }
    }
  }

  if (nameCol === -1) {
    const scores = Array(cols).fill(0);
    for (const row of sample) {
      for (let c = 0; c < cols; c++) {
        if (usedCols.has(c)) continue;
        const val = (row[c] || "").toString().trim();
        if (!val || CNPJ_REGEX.test(val) || NUMBER_LIKE.test(val)) continue;
        if (val.length >= 3) scores[c] += val.length;
      }
    }
    const best = scores.indexOf(Math.max(...scores));
    if (best >= 0) { nameCol = best; usedCols.add(best); }
    else nameCol = 0;
  }

  // Collect extra columns (not yet used)
  const extraCols: { index: number; header: string }[] = [];
  for (let c = 0; c < cols; c++) {
    if (!usedCols.has(c)) {
      const h = (header[c] || `col_${c}`).toString().trim();
      if (h) extraCols.push({ index: c, header: h });
    }
  }

  return { nameCol, cnpjCol, phoneCol, emailCol, contactNameCol, cargoCol, extraCols };
}

function hasHeaderRow(row: string[]): boolean {
  return row.some(c => {
    const v = (c || "").toString().trim();
    return NAME_HEADERS.test(v) || CNPJ_HEADER.test(v) || PHONE_HEADERS.test(v) || EMAIL_HEADERS.test(v) ||
      /^(id|codigo|c[oó]digo|#|num|n[uú]mero|uf|estado|cidade)/i.test(v);
  });
}

function parseRows(rows: string[][]): PlanilhaRow[] {
  if (rows.length === 0) return [];

  const cols = detectColumns(rows);
  const start = hasHeaderRow(rows[0]) ? 1 : 0;

  return rows.slice(start).map(r => {
    const rawCnpj = cols.cnpjCol >= 0 ? (r[cols.cnpjCol] || "").toString().trim() : "";
    const cleanCnpj = rawCnpj.replace(/\D/g, "");
    const hasCnpj = cleanCnpj.length === 14;

    const nome = (r[cols.nameCol] || "").toString().trim();
    const telefone = cols.phoneCol >= 0 ? (r[cols.phoneCol] || "").toString().trim() : null;
    const email = cols.emailCol >= 0 ? (r[cols.emailCol] || "").toString().trim() : null;
    const contato_nome = cols.contactNameCol >= 0 ? (r[cols.contactNameCol] || "").toString().trim() : null;
    const cargo = cols.cargoCol >= 0 ? (r[cols.cargoCol] || "").toString().trim() : null;

    // Collect extra data
    const dados_extras: Record<string, string> = {};
    for (const ec of cols.extraCols) {
      const val = (r[ec.index] || "").toString().trim();
      if (val) dados_extras[ec.header] = val;
    }

    if (!nome && !hasCnpj) return null;

    return {
      nome: nome || (hasCnpj ? cleanCnpj : ""),
      cnpj: hasCnpj ? cleanCnpj : null,
      telefone: telefone || null,
      email: email || null,
      contato_nome: contato_nome || null,
      cargo: cargo || null,
      dados_extras,
      status: hasCnpj ? "fetching" as const : "pending" as const,
    };
  }).filter(Boolean) as PlanilhaRow[];
}

export default function PlanilhaUpload({ onEmpresaFound, onSaveEmpresa, onBatchComplete }: PlanilhaUploadProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<PlanilhaRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [categoria, setCategoria] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");

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
      setFileName(file.name);
      // Default category from filename
      const baseName = file.name.replace(/\.(csv|xlsx|xls)$/i, "").replace(/[_-]/g, " ");
      setCategoria(baseName);
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

    // Create batch in DB
    const batchName = categoria.trim() || fileName || "Importação";
    const { data: batchData } = await supabase.from("upload_batches").insert({
      nome: batchName,
      arquivo_original: fileName,
      total_empresas: items.length,
      total_processadas: 0,
    }).select("id").single();

    const batchId = batchData?.id;

    let processedCount = 0;

    const saveContact = async (item: PlanilhaRow, cnpj: string, empresa?: CnpjData) => {
      if (!batchId) return;
      try {
        await supabase.from("empresa_contacts").insert({
          cnpj,
          batch_id: batchId,
          nome_empresa: empresa?.razao_social || item.nome,
          telefone: item.telefone,
          email: item.email || empresa?.email || null,
          contato_nome: item.contato_nome,
          cargo: item.cargo,
          dados_extras: item.dados_extras,
          score_potencial: 0, // Will be calculated after fetch
        });
      } catch (err) {
        console.error("Erro salvando contato:", err);
      }
    };

    // 1. Fetch items with CNPJs
    const withCnpj = items.filter(n => n.cnpj && n.status === "fetching");
    for (const item of withCnpj) {
      try {
        const empresa = await fetchCnpj(item.cnpj!);
        onEmpresaFound(empresa);
        onSaveEmpresa(empresa);
        await saveContact(item, item.cnpj!, empresa);
        processedCount++;
        setItems(prev => prev.map(n =>
          n.cnpj === item.cnpj ? { ...n, status: "done" as const } : n
        ));
      } catch {
        // Mesmo com erro, salva o contato da planilha pra não perder dados
        await saveContact(item, item.cnpj!);
        setItems(prev => prev.map(n =>
          n.cnpj === item.cnpj ? { ...n, status: "error" as const, error: "CNPJ não encontrado na RF" } : n
        ));
      }
    }

    // 2. Resolve names without CNPJs via AI
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

        for (const item of batch) {
          const match = resultados.find(r =>
            r.nome.toLowerCase() === item.nome.toLowerCase() ||
            item.nome.toLowerCase().includes(r.nome.toLowerCase()) ||
            r.nome.toLowerCase().includes(item.nome.toLowerCase())
          );

          if (!match || !match.cnpj || match.cnpj === "desconhecido") {
            // Salva contato mesmo sem CNPJ pra não perder dados da planilha
            await saveContact(item, "DESCONHECIDO");
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
            await saveContact(item, cnpj, empresa);
            processedCount++;
            setItems(prev => prev.map(n =>
              n.nome === item.nome ? { ...n, status: "done" as const } : n
            ));
          } catch {
            // Salva contato mesmo com erro na Receita
            await saveContact(item, cnpj);
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

    // Update batch count
    if (batchId) {
      await supabase.from("upload_batches").update({ total_processadas: processedCount }).eq("id", batchId);
    }

    setIsProcessing(false);
    onBatchComplete?.();
  };

  const doneCount = items.filter(n => n.status === "done").length;
  const errorCount = items.filter(n => n.status === "error").length;
  const withCnpjCount = items.filter(n => n.cnpj).length;
  const withoutCnpjCount = items.filter(n => !n.cnpj).length;
  const contactCount = items.filter(n => n.telefone || n.email).length;
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
        <span className="text-xs text-muted-foreground">CSV, XLSX — com nomes, CNPJs, telefones, emails</span>
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
              {contactCount > 0 && (
                <Badge variant="default" className="text-[10px]">{contactCount} com contato</Badge>
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
            {/* Categoria / Nome do Lote */}
            {!isProcessing && doneCount === 0 && (
              <div className="flex items-center gap-2">
                <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Categoria do lote (ex: Leads Janeiro, Clientes SP...)"
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            )}

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
                  {n.telefone && <Badge variant="secondary" className="text-[10px]">📞</Badge>}
                  {n.email && <Badge variant="secondary" className="text-[10px]">✉️</Badge>}
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
