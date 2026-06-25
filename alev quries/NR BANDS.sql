Select FileList.CollectionName,
FileList.ASideLocation,
FactNR5GRadio.PosId,
FactNR5GRadio.SessionId,
FactNR5GRadio.PCI,
FactNR5GRadio.NRARFCN,
FactNR5GCellInfo.Band as 'N BAND',
FactNR5GRadio.RSRP,
FactNR5GRadio.RSRQ,
FactNR5GRadio.SINR
from FactNR5GRadio 
  join Sessions  on (FactNR5GRadio.SessionId=sessions.SessionId)
  join FileList  on (FactNR5GRadio.FileId=FileList.FileId)
  join FactNR5GCellInfo  on (FactNR5GRadio.FactIdFactNR5GCellInfo =FactNR5GCellInfo.NR5GCACellInfoId)
where CollectionName like '%%' AND FileList.ASideLocation like '%Data%'