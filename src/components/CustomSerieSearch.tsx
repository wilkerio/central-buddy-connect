import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

interface Props {
  onSearch: (codigo: number) => void;
}

export function CustomSerieSearch({ onSearch }: Props) {
  const [codigo, setCodigo] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(codigo, 10);
    if (!isNaN(num) && num > 0) {
      onSearch(num);
      setCodigo("");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        type="number"
        placeholder="Código da série (ex: 11)"
        value={codigo}
        onChange={(e) => setCodigo(e.target.value)}
        min={1}
        className="max-w-xs"
      />
      <Button type="submit" disabled={!codigo}>
        <Search className="h-4 w-4 mr-2" />
        Buscar
      </Button>
    </form>
  );
}
