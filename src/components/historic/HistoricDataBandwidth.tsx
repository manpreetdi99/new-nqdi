import { fetchHistoricDataBandwidth, type HistoricPageFilters } from "@/lib/api";
import { LoadState, useHistoricLoad } from "./historicShared";
import { SinrThroughputGrid } from "./SinrThroughputScatter";

/**
 * [14] DATA-BANDWIDTH του .pbix — τα δύο scatter (14.4 SINR → DL, 14.6 SINR → UL) από το
 * BI_Capacity. Βλ. get_historic_data_bandwidth στο backend/routers/historic_pages.py.
 */
const HistoricDataBandwidth = ({ filters }: { filters: HistoricPageFilters }) => {
  const key = JSON.stringify(filters);
  const { data, loading, error } = useHistoricLoad(key, () => fetchHistoricDataBandwidth(filters));
  const hasData = !!data && (data.dl.length > 0 || data.ul.length > 0);

  return (
    <LoadState loading={loading} error={error} hasData={hasData}>
      {data && <SinrThroughputGrid data={data} source="BI_Capacity" />}
    </LoadState>
  );
};

export default HistoricDataBandwidth;
