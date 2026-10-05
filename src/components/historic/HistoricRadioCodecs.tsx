import { AudioWaveform, RadioTower } from "lucide-react";

import { fetchHistoricRadioCodecs, type HistoricPageFilters } from "@/lib/api";
import { LoadState, Panel, StackedMixChart, useHistoricLoad } from "./historicShared";

/**
 * [05] RADIO TECH-VOICE CODECS του .pbix — 5 x «100% στοιβαγμένες μπάρες» ανά operator, με τα
 * ίδια visual filters στο ASideLocation (GSM θέσεις vs Free θέσεις). Βλ.
 * get_historic_radio_codecs στο backend/routers/historic_pages.py.
 *
 * Τα codec keys μοιράζονται ΜΙΑ σειρά (CODEC_KEYS) ώστε το ίδιο codec να έχει το ίδιο χρώμα
 * και στα δύο codec charts (GSM / Free).
 */

const CODEC_KEYS = ["EVS", "AMR-WB", "AMR", "Other"];
const GSM_BAND_KEYS = ["GSM 900", "GSM 1800"];
const FREE_TECH_KEYS = ["LTE B1", "LTE B3", "LTE B7", "LTE B8", "LTE B20", "LTE B28", "UMTS", "GSM"];
const RATE_KEYS = ["EVS >13.2", "EVS 13.2", "EVS <13.2", "AMR-WB >0", "AMR-WB 0", "AMR"];

const HistoricRadioCodecs = ({ filters }: { filters: HistoricPageFilters }) => {
  const key = JSON.stringify(filters);
  const { data, loading, error } = useHistoricLoad(key, () => fetchHistoricRadioCodecs(filters));
  const hasData = !!data && Object.values(data).some((rows) => rows.length > 0);

  return (
    <LoadState loading={loading} error={error} hasData={hasData}>
      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Radio technology — GSM (M→F) calls" subtitle="Share of radio samples per GSM band, GSM locations" icon={RadioTower}>
              <StackedMixChart rows={data.gsmBands} keys={GSM_BAND_KEYS} />
            </Panel>
            <Panel title="Voice codec — GSM (M→F) calls" subtitle="Share of speech samples per codec · hover for MOS" icon={AudioWaveform}>
              <StackedMixChart rows={data.gsmCodecs} keys={CODEC_KEYS} />
            </Panel>
            <Panel title="Radio technology — Free (M→M) calls" subtitle="Share of radio samples per LTE band / RAT, Free locations" icon={RadioTower}>
              <StackedMixChart rows={data.freeTech} keys={FREE_TECH_KEYS} />
            </Panel>
            <Panel title="Voice codec — Free (M→M) calls" subtitle="Share of speech samples per codec · hover for MOS" icon={AudioWaveform}>
              <StackedMixChart rows={data.freeCodecs} keys={CODEC_KEYS} />
            </Panel>
          </div>
          <Panel
            title="Codec bit rate — Free (M→M) calls"
            subtitle="EVS and AMR-WB bit-rate classes (kbps), weighted by speech samples · hover for MOS"
            icon={AudioWaveform}
          >
            <StackedMixChart rows={data.evsRates} keys={RATE_KEYS} valueIsPercent />
          </Panel>
        </>
      )}
    </LoadState>
  );
};

export default HistoricRadioCodecs;
