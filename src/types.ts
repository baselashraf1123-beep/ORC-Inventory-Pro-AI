export interface InventoryItem {
  id: string;
  code: string; // ITEM NO
  colorNo: string;
  quantity: number; // LENGTH
  unit: string;
  sessionId: string;
  createdAt: string;
  isExported: boolean;
  notes?: string;
}

export interface OCRTask {
  id: string;
  image: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  error?: string;
  result?: {
    itemNo: string;
    colorNo: string;
    length: string;
    unit?: string;
    notes?: string;
  };
}
