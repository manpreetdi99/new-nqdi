Select 
FileList.CollectionName,
FileList.ASideLocation, 
Sessions.SessionId, 
TestInfo.TestId,
NetworkInfo.HomeOperator,
NetworkInfo.Technology,
CallSession.CallTechnology,
CallSession.CallDir as 'CallDirection',
CallSession.CallType as 'CallType',
SampleSettingsInfo.Direction as 'SampleDirection',  
Round(ResultsLq08Avg.OptionalWB,3)as 'Polqa',
Case when(ResultsLq08Avg.LQWB>0)And(ResultsLQ08Avg.OptionalWB is NULL)And(ResultsLq08Avg.P862LQ is NULL)then 'SQuad08-WB'
	when(ResultsLQ08Avg.LQWB is Null)And(ResultsLQ08Avg.OptionalWB>0)And(ResultsLQ08Avg.P862LQ is Null)then 'P.863-SWB'
	when(ResultsLQ08Avg.LQWB is Null)And(ResultsLQ08Avg.OptionalWB is NULL)And(ResultsLQ08Avg.P862LQ>0)then 'P.862.1'
	when(ResultsLQ08Avg.LQWB>0)And(ResultsLQ08Avg.OptionalWB>0)And(ResultsLQ08Avg.P862LQ is Null)then 'SQuad08-NB/P.863-NB'
	when(ResultsLQ08Avg.LQWB>0)And(ResultsLQ08Avg.OptionalWB is NULL)And(ResultsLQ08Avg.P862LQ>0)then 'SQuad08-NB/P.862.1'
	when(ResultsLQ08Avg.LQWB is NULL)And(ResultsLQ08Avg.OptionalWB>0)And(ResultsLQ08Avg.P862LQ>0)then 'P.862.1/P.863-NB'
	when(ResultsLQ08Avg.LQWB>0)And(ResultsLQ08Avg.OptionalWB>0)And(ResultsLQ08Avg.P862LQ>0)then 'SQuad08-NB/P.862.1/P.863-NB'
	when((ResultsLq08Avg.LQWB is Null)And(ResultsLQ08Avg.OptionalWB is NULL)And(ResultsLq08Avg.P862LQ is Null) And (SUBSTRING(Reverse(ResultsLq08Avg.QualityCode),10,1) like '1'))
	Then 'Silence'
	Else NULL End as 'LQType',
Case when vvct.CodecName is Null then 'no codec rate'
		when vvct.CodecName='-'then 'no codec rate'
		else vvct.CodecName end as 'CodecRate',
Case when vvctBSide.CodecName is Null then 'no codec rate'
		when vvctBSide.CodecName='-'then 'no codec rate'
		else vvctBSide.CodecName end as 'CodecRateBSide',
Case when ResultsLq08Avg.QualityCode <> '' then 1 else 0 end as 'QCode',
ResultsLq08Avg.QualityCode,
vvct.CodecRateFloat as 'Bit_Rate'


into #MOS_BI


from Sessions 	Join FileList On(Sessions.FileID = FileList.FileID)
		Join TestInfo On(Sessions.SessionID = TestInfo.SessionID)
		Join CallSession On(Sessions.SessionID = CallSession.SessionID)
		Join SampleSettingsInfo On(TestInfo.SampleID = SampleSettingsInfo.SampleID)
		Join ResultsLq08Avg On(TestInfo.TestID =ResultsLq08Avg.TestID)
		Join NetworkInfo On(TestInfo.NetworkID = NetworkInfo.NetworkID)
		Left Join vVoiceCodecTest vvct On(ResultsLq08Avg.TestID = vvct.TestID and
						((TestInfo.direction='A->B'And vvct.Direction='U')or
						(TestInfo.direction='B->A'And vvct.Direction='D')))
		Left Join vVoiceCodecTestBSide vvctBSide On(ResultsLq08Avg.TestID=vvctBSide.TestID and
						((TestInfo.direction='A->B'And vvctBSide.Direction='D')or
						(TestInfo.direction='B->A'And vvctBSide.Direction='U')))


where Sessions.Valid = 1 And
Callsession.Callstatus Not In('System Release','failed') and
TestInfo.Valid = 1 And
ResultsLq08Avg.Appl%10<>0

order by Sessions.SessionId ,TestInfo.TestId



-------------------------------------------------------------------

Select 
m.HomeOperator,
m.ASideLocation,
m.CollectionName,

count(case when m.CodecRate like 'EVS%' then m.CodecRate  end) as 'EVS_Samples' ,
count(case when m.CodecRate like 'EVS%' then m.CodecRate  end)*100.0/count(m.CodecRate) as 'EVS_Perc' ,
AVG(case when m.CodecRate like 'EVS%' then m.Polqa end) as 'MOS_EVS',



Count(case when m.CodecRate like 'AMR WB%' then m.CodecRate end) as 'AMR_WB_Samples' ,
Count(case when m.CodecRate like 'AMR WB%' then m.CodecRate end)*100.0/count(m.CodecRate) as 'AMR_WB_Perc' ,
AVG(case when m.CodecRate like 'AMR WB%' then m.Polqa end) as 'MOS_AMR_WB' ,



Count(case when m.CodecRate like 'AMR%' and m.CodecRate not like 'AMR WB%' then m.CodecRate  end) as 'AMR_Samples' ,
Count(case when m.CodecRate like 'AMR%' and m.CodecRate not like 'AMR WB%' then m.CodecRate  end)*100.0/count(m.CodecRate)  as 'AMR_Perc' ,
AVG(case when m.CodecRate like 'AMR%' and m.CodecRate not like 'AMR WB%' then m.Polqa  end) as 'MOS_AMR' ,



Count(case when m.CodecRate not like '%EVS%' and m.CodecRate not like 'AMR%'  then m.CodecRate end) as 'All_Others' ,
Count(case when m.CodecRate not like '%EVS%' and m.CodecRate not like 'AMR%'  then m.CodecRate end)*100.0/count(m.CodecRate) as 'All_Others_Perc' ,
AVG(case when m.CodecRate not like '%EVS%' and m.CodecRate not like 'AMR%'  then m.Polqa end) as 'MOS_All_Others' ,




count(m.CodecRate) as 'Total_Samples',
AVG(m.Polqa) as 'Total_MOS',


count(case when m.Bit_Rate < 13.2 and m.CodecRate like 'EVS%' then m.Bit_Rate end)*100.0/count(m.Bit_Rate) as 'EVS_lower_13',
AVG(case when m.Bit_Rate < 13.2 and m.CodecRate like 'EVS%' then m.Polqa end) as 'MOS_EVS_lower_13',
count(case when m.Bit_Rate = 13.2 and m.CodecRate like 'EVS%' then m.Bit_Rate end)*100.0/count(m.Bit_Rate) as 'EVS_13',
AVG(case when m.Bit_Rate = 13.2 and m.CodecRate like 'EVS%' then m.Polqa end) as 'MOS_EVS_13',
count(case when m.Bit_Rate > 13.2 and m.CodecRate like 'EVS%' then m.Bit_Rate end)*100.0/count(m.Bit_Rate) as 'EVS_24',
AVG(case when m.Bit_Rate > 13.2 and m.CodecRate like 'EVS%' then m.Polqa end) as 'MOS_EVS_24',
count(case when m.Bit_Rate = 0 and m.CodecRate like 'AMR WB%' then m.Bit_Rate end)*100.0/count(m.Bit_Rate) as 'AMR_WB_0',
AVG(case when m.Bit_Rate = 0 and m.CodecRate like 'AMR WB%' then m.Polqa end) as 'MOS_AMR_WB_0',
count(case when m.Bit_Rate > 0 and m.CodecRate like 'AMR WB%' then m.Bit_Rate end)*100.0/count(m.Bit_Rate) as 'AMR_WB_NOT_0',
AVG(case when m.Bit_Rate > 0 and m.CodecRate like 'AMR WB%' then m.Polqa end) as 'MOS_AMR_WB_not_0',
count(case when m.CodecRate like 'AMR%' and m.CodecRate not like 'AMR WB%' then m.Bit_Rate end)*100.0/count(m.Bit_Rate) as 'AMR'


into BI_VOICE_CODEC

from #MOS_BI m
where ASideLocation not like '%DATA%' and ASideLocation not like '%MQNCM%'


group by 
m.HomeOperator,
m.ASideLocation,
m.CollectionName

order by  m.CollectionName,m.ASideLocation


drop table #MOS_BI
--drop table BI_VOICE_CODEC