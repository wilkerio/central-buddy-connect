import { Badge } from "@/components/ui/badge";
import { ExternalLink, ShieldCheck, AlertTriangle, Info, FileText } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

export type ConfiancaNivel = 'alta' | 'media' | 'baixa' | 'estimativa';

export interface Fonte {
  nome: string;
  url: string;
  tipo: string;
}

interface SourceIndicatorProps {
  confianca: ConfiancaNivel;
  fontes: Fonte[];
  compact?: boolean;
}

const CONFIANCA_CONFIG: Record<ConfiancaNivel, { label: string; icon: any; badgeClass: string; description: string }> = {
  alta: {
    label: 'Dado Real',
    icon: ShieldCheck,
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800',
    description: 'Dados confirmados por fontes oficiais do governo ou órgãos reguladores.',
  },
  media: {
    label: 'Verificado',
    icon: FileText,
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800',
    description: 'Dados encontrados em fontes confiáveis da imprensa financeira ou jurídica.',
  },
  baixa: {
    label: 'Fonte Web',
    icon: Info,
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
    description: 'Dados encontrados em fontes web diversas. Recomenda-se verificação manual.',
  },
  estimativa: {
    label: 'Estimativa',
    icon: AlertTriangle,
    badgeClass: 'bg-muted text-muted-foreground border-border',
    description: 'Dados estimados por algoritmo interno. Não foram encontradas fontes públicas.',
  },
};

const TIPO_FONTE_LABEL: Record<string, string> = {
  oficial: '🏛️ Fonte Oficial',
  imprensa_financeira: '📰 Imprensa Financeira',
  juridico: '⚖️ Fonte Jurídica',
  consumidor: '👥 Plataforma do Consumidor',
  scraping: '🔍 Dados Extraídos',
  web: '🌐 Fonte Web',
};

export function SourceIndicator({ confianca, fontes, compact = false }: SourceIndicatorProps) {
  const config = CONFIANCA_CONFIG[confianca as keyof typeof CONFIANCA_CONFIG] || CONFIANCA_CONFIG['estimativa'];
  const Icon = config.icon;

  if (compact) {
    return (
      <HoverCard>
        <HoverCardTrigger asChild>
          <Badge variant="outline" className={`cursor-help text-[10px] gap-1 ${config.badgeClass}`}>
            <Icon className="h-2.5 w-2.5" />
            {config.label}
          </Badge>
        </HoverCardTrigger>
        <HoverCardContent className="w-72 p-3 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5" />
            {config.label}
          </p>
          <p className="text-xs text-muted-foreground">{config.description}</p>
          {fontes.length > 0 && (
            <div className="space-y-1 pt-1 border-t">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Fontes</p>
              {fontes.map((f, i) => (
                <a
                  key={i}
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline truncate"
                >
                  <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
                  <span className="truncate">{f.nome}</span>
                </a>
              ))}
            </div>
          )}
        </HoverCardContent>
      </HoverCard>
    );
  }

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className={`text-xs gap-1 ${config.badgeClass}`}>
          <Icon className="h-3 w-3" />
          {config.label}
        </Badge>
        <span className="text-[10px] text-muted-foreground">{fontes.length} fonte{fontes.length !== 1 ? 's' : ''}</span>
      </div>
      <p className="text-[10px] text-muted-foreground">{config.description}</p>
      {fontes.length > 0 && (
        <div className="space-y-1">
          {fontes.map((f, i) => (
            <a
              key={i}
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs p-1.5 rounded border bg-background hover:bg-accent/50 transition-colors group"
            >
              <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-medium text-foreground group-hover:text-primary truncate block">{f.nome}</span>
                <span className="text-[10px] text-muted-foreground">{TIPO_FONTE_LABEL[f.tipo] || f.tipo}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function SourceBadgeRow({ confianca, fontes }: { confianca: ConfiancaNivel; fontes: Fonte[] }) {
  const config = CONFIANCA_CONFIG[confianca as keyof typeof CONFIANCA_CONFIG] || CONFIANCA_CONFIG['estimativa'];
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge variant="outline" className={`text-[10px] gap-1 ${config.badgeClass}`}>
        <Icon className="h-2.5 w-2.5" />
        {config.label}
      </Badge>
      {fontes.slice(0, 3).map((f, i) => (
        <a
          key={i}
          href={f.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-2.5 w-2.5" />
          {f.nome}
        </a>
      ))}
      {fontes.length > 3 && (
        <span className="text-[10px] text-muted-foreground">+{fontes.length - 3} fontes</span>
      )}
    </div>
  );
}
