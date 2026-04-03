import React, { useState, useEffect } from 'react';

/**
 * ΠΑΡΑΔΕΙΓΜΑ & TIPS ΓΙΑ ΤΟ ΔΙΚΟ ΣΟΥ PROJECT (React + TypeScript)
 * 
 * Επειδή το project σου έχει components όπως `CallDetail`, `CallsList`, `ResultsTable`,
 * είναι πολύ σημαντικό να χρησιμοποιείς την TypeScript για να περιγράφεις τα δεδομένα σου (domain models).
 */

// 1. ΟΡΙΣΜΟΣ ΜΟΝΤΕΛΩΝ (Τύποι Δεδομένων)
// Φτιάχνουμε interfaces για τα δεδομένα που επιστρέφει το backend σου (π.χ. από το app.py/db.py)
export interface CallRecord {
  id: string;
  callerNumber: string;
  receiverNumber: string;
  durationSeconds: number;
  timestamp: string; // ISO date string
  status: 'completed' | 'missed' | 'failed'; // Union type (μόνο αυτές οι 3 τιμές επιτρέπονται)
}

// 2. ΤΥΠΟΠΟΙΗΣΗ PROPS (Παράμετροι Components)
// Κάθε component (όπως το CallDetail.tsx που δουλεύεις) πρέπει να έχει ένα interface για τα props του.
interface CallDetailProps {
  call: CallRecord; // Υποχρεωτικό prop
  showExtraInfo?: boolean; // Προαιρετικό prop (λόγω του '?')
  onClose: () => void; // Συνάρτηση (callback) που δεν επιστρέφει τίποτα
}

// 3. REACT COMPONENTS ΜΕ TYPESCRIPT
// Δίνουμε τον τύπο `CallDetailProps` στα ορίσματα της συνάρτησης.
export const CallDetailDemo = ({ call, showExtraInfo = false, onClose }: CallDetailProps) => {
  
  // 4. ΤΥΠΟΠΟΙΗΣΗ STATE (useState)
  // Πολλές φορές η TS καταλαβαίνει μόνη της (inference), αλλά κάποιες φορές πρέπει να είμαστε ξεκάθαροι:
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [extraData, setExtraData] = useState<string | null>(null); // Μπορεί να είναι string ή null

  // 5. ΤΥΠΟΠΟΙΗΣΗ EVENTS (Συμβάντα)
  // Όταν έχουμε events (όπως κλικ σε κουμπί ή αλλαγή σε input), χρησιμοποιούμε τους τύπους της React:
  const handleToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Το event.preventDefault() κλπ είναι πλέον strongly typed
    setIsExpanded(!isExpanded);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    console.log("Νέο κείμενο:", event.target.value);
  };

  return (
    <div className="p-4 border rounded-md shadow-sm space-y-2">
      <h2 className="text-xl font-semibold">Λεπτομέρειες Κλήσης</h2>
      
      <div className="text-sm text-gray-600">
        <p>Από: {call.callerNumber}</p>
        <p>Προς: {call.receiverNumber}</p>
        <p>Κατάσταση: 
          {/* Παράδειγμα χρήσης του union type: */}
          <span className={call.status === 'missed' ? 'text-red-500' : 'text-green-500'}>
            {call.status}
          </span>
        </p>
      </div>

      <button 
        onClick={handleToggle}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        {isExpanded ? 'Απόκρυψη' : 'Εμφάνιση Περισσοτέρων'}
      </button>

      {/* 6. ΠΑΡΑΔΕΙΓΜΑ CHILDREN & ΚΛΗΣΗ CALLBACK */}
      <button 
        onClick={onClose}
        className="ml-2 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
      >
        Κλείσιμο
      </button>
    </div>
  );
};

/**
 * 7. ΤΥΠΟΠΟΙΗΣΗ API CALLS (fetch / axios)
 * Πώς τραβάμε δεδομένα από το Python backend μας με ασφάλεια.
 */
export async function fetchCallsFromBackend(): Promise<CallRecord[]> {
  try {
    const response = await fetch('/api/calls'); // Το endpoint του FastAPI/Flask σου
    if (!response.ok) throw new Error('Network response was not ok');
    
    // Εδώ "λέμε" στην TypeScript ότι το JSON που επιστρέφεται είναι Array από CallRecord
    const data = await response.json() as CallRecord[];
    return data;
  } catch (error) {
    console.error("Σφάλμα:", error);
    return [];
  }
}
