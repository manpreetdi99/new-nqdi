import { useMemo } from "react";
import { Filter } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CallRecord } from "@/lib/callData";

export interface CallFilters {
  operator: string;
  status: string;
  technology: string;
  region: string;
  callType: string;
}

interface CallsFilterProps {
  calls: CallRecord[];
  filters: CallFilters;
  onFiltersChange: (filters: CallFilters) => void;
}

const CallsFilter = ({ calls, filters, onFiltersChange }: CallsFilterProps) => {
  const options = useMemo(() => ({
    operators: [...new Set(calls.map((c) => c.operator))].sort(),
    statuses: [...new Set(calls.map((c) => c.status))].sort(),
    technologies: [...new Set(calls.map((c) => c.technology))].sort(),
    regions: [...new Set(calls.map((c) => c.region))].sort(),
    callTypes: [...new Set(calls.map((c) => c.callType))].sort(),
  }), [calls]);

  const update = (key: keyof CallFilters, value: string) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const filterItems = [
    { key: "operator" as const, label: "Operator", opts: options.operators },
    { key: "status" as const, label: "Status", opts: options.statuses },
    { key: "technology" as const, label: "Technology", opts: options.technologies },
    { key: "region" as const, label: "Region", opts: options.regions },
    { key: "callType" as const, label: "Call Type", opts: options.callTypes },
  ];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Filter className="h-3.5 w-3.5 text-muted-foreground" />
      {filterItems.map((f) => (
        <Select
          key={f.key}
          value={filters[f.key]}
          onValueChange={(v) => update(f.key, v)}
        >
          <SelectTrigger className="h-8 w-[140px] text-xs bg-background border-border">
            <SelectValue placeholder={f.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All {f.label}s</SelectItem>
            {f.opts.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
    </div>
  );
};

export default CallsFilter;
