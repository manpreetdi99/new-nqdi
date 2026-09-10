import React from 'react';
import { createRoot } from 'react-dom/client';
import { L3SignalingPanel } from '../src/components/L3SignalingPanel';
import '../src/index.css';
const base = Date.parse('2026-09-10T12:00:00Z');
const rows = (n, step) => Array.from({length:n}, (_,i) => ({
 Phase:'during', SecondsFromCallStart:i*step, MsgTime:new Date(base+i*step*1000).toISOString(),
 SessionId:'1', Technology:i%3?'LTE':'SIP', Direction:i%2?'U':'D', Layer:i%3?'RRC':'SIP',
 MsgName:i===40?'RRCReject':'Message '+i, SimpleMsgName:i===40?'RRCReject':'Message '+i,
 Category:null, Class:null, SIPResponse:null, CombinedMsgNameSIPResponse:null, SIPCallId:null,
 PCI:123, ARFCN:6400, Message: 'Decoded payload '.repeat(200)
}));
const data = (messages) => ({callWindow:{CallStart:new Date(base).toISOString(),CallEnd:new Date(base+120000).toISOString(),callDir:'MO'}, l3Messages:messages, summary:{total:messages.length,byPhase:{before:0,during:messages.length,after:0},windowBeforeSec:10,windowAfterSec:10}});
createRoot(document.getElementById('root')).render(<div className="p-4 dark bg-background text-foreground min-h-screen"><L3SignalingPanel asideLocation="Cosmote Free A" l3Data={data(rows(180,1))} l3DataBSide={data(rows(90,2))}/></div>);
