/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  Camera, 
  History, 
  Search,
  Settings, 
  ChevronLeft, 
  Scan, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  X, 
  Save,
  Trash2,
  Download,
  ZoomIn,
  Plus,
  LayoutGrid,
  Filter,
  Share2,
  Undo2,
  Redo2,
  User,
  Phone,
  ExternalLink,
  Edit2,
  ChevronUp,
  ChevronDown,
  Play
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { Preferences } from '@capacitor/preferences';
import { compressImage } from './lib/imageUtils';
import { OCRService } from './services/ocrService';
import { InventoryItem, OCRTask } from './types';

const ocrService = new OCRService();

const STORAGE_KEY = 'orc_inventory_pro_data';

export default function App() {
  const [view, setView] = useState<'home' | 'batch' | 'list' | 'settings' | 'manual'>('home');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [history, setHistory] = useState<InventoryItem[][]>([]);
  const [redoStack, setRedoStack] = useState<InventoryItem[][]>([]);
  const [tasks, setTasks] = useState<OCRTask[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [editingTask, setEditingTask] = useState<OCRTask | null>(null);
  const [editingSavedItem, setEditingSavedItem] = useState<InventoryItem | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type: 'danger' | 'success' | 'info';
  }>({
    show: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'info'
  });
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({
    show: false,
    message: '',
    type: 'success'
  });
  const [lastSessionId, setLastSessionId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [manualItem, setManualItem] = useState<Partial<InventoryItem>>({
    code: '',
    colorNo: '',
    quantity: 0,
    unit: 'M',
    notes: ''
  });

  // Load data and handle migration
  useEffect(() => {
    const loadData = async () => {
      // 1. Check Preferences first
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      
      if (value) {
        setItems(JSON.parse(value));
      } else {
        // 2. Fallback to localStorage for migration
        const legacyData = localStorage.getItem(STORAGE_KEY);
        if (legacyData) {
          const parsed = JSON.parse(legacyData);
          setItems(parsed);
          // Save to Preferences immediately
          await Preferences.set({ key: STORAGE_KEY, value: legacyData });
          // Optional: clear localStorage after successful migration
          // localStorage.removeItem(STORAGE_KEY);
        }
      }
      setIsDataLoaded(true);
    };
    loadData();
  }, []);

  // Save data to Preferences with Debounce to prevent UI lag on large lists
  useEffect(() => {
    if (!isDataLoaded) return;
    
    const timer = setTimeout(() => {
      Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(items) });
    }, 1000); // Wait 1 second after last change before saving

    return () => clearTimeout(timer);
  }, [items, isDataLoaded]);

  // Security & IP Protection Measures
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      e.preventDefault();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U, Ctrl+S, Ctrl+P
      if (
        e.key === 'F12' ||
        (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) ||
        (e.ctrlKey && (e.key === 'U' || e.key === 'u' || e.key === 'S' || e.key === 's' || e.key === 'P' || e.key === 'p'))
      ) {
        e.preventDefault();
        return false;
      }
    };
    const handleCopy = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      e.preventDefault();
    };
    const handleDragStart = (e: DragEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      e.preventDefault();
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('copy', handleCopy);
    document.addEventListener('dragstart', handleDragStart);

    // Add a non-removable watermark style to body
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    
    // Allow selection on inputs and textareas
    const style = document.createElement('style');
    style.innerHTML = 'input, textarea { user-select: auto !important; -webkit-user-select: auto !important; }';
    document.head.appendChild(style);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('dragstart', handleDragStart);
      document.body.style.userSelect = 'auto';
      document.body.style.webkitUserSelect = 'auto';
      document.head.removeChild(style);
    };
  }, []);

  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, message, type });
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
  }, []);

  const updateItemsWithHistory = useCallback((newItems: InventoryItem[]) => {
    setHistory(prev => {
      const newHistory = [...prev, items];
      return newHistory.slice(-5); // Limit history to 5 steps to save memory on mobile
    });
    setRedoStack([]);
    setItems(newItems);
  }, [items]);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setRedoStack(prev => [...prev, items]);
    setHistory(prev => prev.slice(0, -1));
    setItems(previous);
  }, [history, items]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setHistory(prev => [...prev, items]);
    setRedoStack(prev => prev.slice(0, -1));
    setItems(next);
  }, [redoStack, items]);

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isProcessing) {
      showToast('يرجى الانتظار حتى تنتهي المعالجة الحالية', 'error');
      return;
    }
    try {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      
      if (files.length > 50) {
        showToast('الحد الأقصى هو 50 صورة في الدفعة الواحدة للحفاظ على أداء الجهاز', 'error');
        // Reset the input
        e.target.value = '';
        return;
      }

      const newTasks: OCRTask[] = await Promise.all(
        files.map(async (file: any) => {
          const base64 = await fileToBase64(file);
          return {
            id: Math.random().toString(36).substr(2, 9),
            image: base64,
            status: 'pending'
          };
        })
      );

      setTasks(newTasks);
      setView('batch');
    } catch (error) {
      console.error("Error processing images:", error);
      showToast("حدث خطأ أثناء معالجة الصور", "error");
    } finally {
      e.target.value = '';
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const MAX_DIMENSION = 1200;
          
          if (width > height && width > MAX_DIMENSION) {
            height *= MAX_DIMENSION / width;
            width = MAX_DIMENSION;
          } else if (height > MAX_DIMENSION) {
            width *= MAX_DIMENSION / height;
            height = MAX_DIMENSION;
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.8));
          } else {
            resolve(e.target?.result as string);
          }
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const startBatchProcessing = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    
    const tasksToProcess = tasks.filter(t => t.status === 'pending' || t.status === 'failed');
    if (tasksToProcess.length === 0) {
      setIsProcessing(false);
      return;
    }
    
    setBatchProgress({ current: 0, total: tasksToProcess.length });
    
    let currentTasks = [...tasks];
    let processedCount = 0;
    
    for (let i = 0; i < currentTasks.length; i++) {
      if (currentTasks[i].status !== 'pending' && currentTasks[i].status !== 'failed') continue;
      
      currentTasks[i].status = 'processing';
      currentTasks[i].error = undefined;
      setTasks([...currentTasks]);

      try {
        // ضغط الصورة قبل الإرسال لتحسين الأداء وسرعة الرفع
        const compressed = await compressImage(currentTasks[i].image);
        const result = await ocrService.processImage(compressed);
        
        currentTasks[i].result = {
          itemNo: result.itemNo,
          colorNo: result.colorNo,
          length: result.length,
          unit: result.unit,
          notes: result.notes
        };
        currentTasks[i].status = (result.itemNo && result.length) ? 'success' : 'failed';
        
        // Memory Optimization: Clear raw image data after successful processing
        if (currentTasks[i].status === 'success') {
          currentTasks[i].image = ''; // Keep memory low on mobile
        }

        if (currentTasks[i].status === 'failed') {
          currentTasks[i].error = "لم يتم العثور على بيانات واضحة في الصورة";
        }
      } catch (error: any) {
        console.error("Batch processing error:", error);
        currentTasks[i].status = 'failed';
        currentTasks[i].error = error.message || "خطأ في الاتصال بالخادم";
      }
      
      setTasks([...currentTasks]);
      processedCount++;
      setBatchProgress({ current: processedCount, total: tasksToProcess.length });
    }
    setIsProcessing(false);
  };

  const moveTask = (index: number, direction: 'up' | 'down') => {
    if (isProcessing) return;
    const newTasks = [...tasks];
    if (direction === 'up' && index > 0) {
      [newTasks[index - 1], newTasks[index]] = [newTasks[index], newTasks[index - 1]];
    } else if (direction === 'down' && index < newTasks.length - 1) {
      [newTasks[index + 1], newTasks[index]] = [newTasks[index], newTasks[index + 1]];
    }
    setTasks(newTasks);
  };

  const removeTask = (id: string) => {
    if (isProcessing) return;
    const newTasks = tasks.filter(t => t.id !== id);
    setTasks(newTasks);
    if (newTasks.length === 0) setView('home');
  };

  const saveManualItem = () => {
    // Robust Validation
    const code = manualItem.code?.trim();
    const quantity = manualItem.quantity;
    
    if (!code || code.length < 2) {
      showToast('كود الصنف يجب أن يكون حرفين على الأقل', 'error');
      return;
    }
    
    if (quantity === undefined || isNaN(quantity) || quantity <= 0) {
      showToast('يرجى إدخال كمية صحيحة أكبر من صفر', 'error');
      return;
    }

    const newItem: InventoryItem = {
      id: Math.random().toString(36).substr(2, 9),
      code: code.toUpperCase(),
      colorNo: (manualItem.colorNo || '').trim().toUpperCase(),
      quantity: quantity,
      unit: manualItem.unit || 'M',
      notes: (manualItem.notes || '').trim(),
      sessionId: `MANUAL_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      createdAt: new Date().toISOString(),
      isExported: false
    };

    // Duplicate check
    const isDuplicate = items.some(existingItem => 
      existingItem.code === newItem.code && existingItem.colorNo === newItem.colorNo
    );

    if (isDuplicate) {
      setConfirmModal({
        show: true,
        title: 'تنبيه: صنف مكرر',
        message: 'هذا الصنف (الكود واللون) موجود بالفعل في السجلات. هل تريد المتابعة وحفظه مرة أخرى؟',
        type: 'info',
        onConfirm: () => {
          updateItemsWithHistory([newItem, ...items]);
          setManualItem({ code: '', colorNo: '', quantity: 0, unit: 'M', notes: '' });
          setView('home');
          setConfirmModal(prev => ({ ...prev, show: false }));
        }
      });
      return;
    }

    updateItemsWithHistory([newItem, ...items]);
    setManualItem({ code: '', colorNo: '', quantity: 0, unit: 'M', notes: '' });
    showToast('تم حفظ الصنف بنجاح');
    setView('home');
  };

  const stats = useMemo(() => {
    const totalMeters = items.reduce((acc, i) => i.unit === 'M' ? acc + i.quantity : acc, 0);
    const totalYards = items.reduce((acc, i) => i.unit === 'Yard' ? acc + i.quantity : acc, 0);
    const newItems = items.filter(i => !i.isExported).length;
    const exportedItems = items.filter(i => i.isExported).length;
    return { totalMeters, totalYards, newItems, exportedItems, totalCount: items.length };
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter(item => 
      item.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.colorNo.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [items, searchQuery]);

  const clearAllData = () => {
    if (items.length === 0) return;
    
    setConfirmModal({
      show: true,
      title: 'حذف جميع البيانات',
      message: 'هل أنت متأكد تماماً من حذف جميع السجلات؟ لا يمكن التراجع عن هذه العملية.',
      type: 'error',
      onConfirm: () => {
        updateItemsWithHistory([]);
        showToast('تم مسح جميع البيانات بنجاح', 'success');
        setConfirmModal(prev => ({ ...prev, show: false }));
      }
    });
  };

  const saveBatch = () => {
    if (isProcessing) return;
    
    const validTasks = tasks.filter(t => {
      const qty = parseFloat(t.result?.length || '0');
      return t.result?.itemNo && qty > 0;
    });
    
    if (validTasks.length === 0) {
      setConfirmModal({
        show: true,
        title: 'تنبيه',
        message: 'لا توجد بيانات صالحة للحفظ (تأكد من إدخال كود الصنف وكمية أكبر من صفر)',
        type: 'info',
        onConfirm: () => setConfirmModal(prev => ({ ...prev, show: false }))
      });
      return;
    }

    setConfirmModal({
      show: true,
      title: 'تأكيد الحفظ',
      message: `هل أنت متأكد من حفظ ${validTasks.length} أصناف في السجلات؟`,
      type: 'success',
      onConfirm: () => {
        setIsProcessing(true);
        const sessionId = `BATCH_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        setLastSessionId(sessionId);
        
        const newItems: InventoryItem[] = validTasks.map(t => ({
          id: Math.random().toString(36).substr(2, 9),
          code: (t.result?.itemNo || '').trim().toUpperCase(),
          colorNo: (t.result?.colorNo || '').trim().toUpperCase(),
          quantity: parseFloat(t.result?.length || '0') || 0,
          unit: (t.result?.unit || 'M') as 'M' | 'Yard' | 'Roll' | 'Piece',
          notes: (t.result?.notes || '').trim(),
          sessionId,
          createdAt: new Date().toISOString(),
          isExported: false
        }));

        // Duplicate check
        const duplicates = newItems.filter(newItem => 
          items.some(existingItem => existingItem.code === newItem.code && existingItem.colorNo === newItem.colorNo)
        );

        if (duplicates.length > 0) {
          setConfirmModal({
            show: true,
            title: 'تنبيه: أصناف مكررة',
            message: `تم العثور على ${duplicates.length} أصناف مكررة بالفعل في السجلات. هل تريد المتابعة وحفظها مرة أخرى؟`,
            type: 'info',
            onConfirm: () => {
              updateItemsWithHistory([...newItems, ...items]);
              setTasks([]);
              showToast(`تم حفظ ${newItems.length} أصناف بنجاح`);
              setView('home');
              setConfirmModal(prev => ({ ...prev, show: false }));
              setIsProcessing(false);
            }
          });
        } else {
          updateItemsWithHistory([...newItems, ...items]);
          setTasks([]);
          showToast(`تم حفظ ${newItems.length} أصناف بنجاح`);
          setView('home');
          setConfirmModal(prev => ({ ...prev, show: false }));
          setIsProcessing(false);
        }
      }
    });
  };

  const exportToExcel = async (mode: 'ALL' | 'NEW' | 'SESSION') => {
    try {
      let targetItems = items;
      if (mode === 'NEW') targetItems = items.filter(i => !i.isExported);
      if (mode === 'SESSION' && lastSessionId) {
        targetItems = items.filter(i => i.sessionId === lastSessionId);
      } else if (mode === 'SESSION' && items.length > 0) {
        targetItems = items.filter(i => i.sessionId === items[0].sessionId);
      }

      if (targetItems.length === 0) {
        setConfirmModal({
          show: true,
          title: 'تنبيه',
          message: 'لا توجد بيانات للتصدير في هذا التصنيف',
          type: 'info',
          onConfirm: () => setConfirmModal(prev => ({ ...prev, show: false }))
        });
        return;
      }

      const worksheet = XLSX.utils.json_to_sheet(targetItems.map(i => ({
        'ITEM NO': i.code,
        'COLOR NO': i.colorNo,
        'LENGTH': i.quantity,
        'UNIT': i.unit,
        'NOTES': i.notes,
        'SESSION': i.sessionId,
        'DATE': new Date(i.createdAt).toLocaleString('ar-EG'),
        'STATUS': i.isExported ? 'تم التصدير' : 'جديد'
      })));

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "المخزون");
      
      const fileName = `Inventory_${mode}_${new Date().toISOString().split('T')[0]}.xlsx`;
      
      // Try native sharing first (works well in Capacitor/Mobile Web)
      try {
        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const file = new File([blob], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        
        let shared = false;
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: 'تقرير المخزون',
              text: 'مرفق تقرير المخزون بصيغة Excel'
            });
            shared = true;
          } catch (shareError: any) {
            if (shareError.name === 'AbortError') {
              console.log('User cancelled sharing');
              return; 
            }
            console.warn('Native share failed, falling back to download:', shareError);
            // Don't throw here, let it fall back to XLSX.writeFile
          }
        }

        if (!shared) {
          // Fallback to standard download
          try {
            XLSX.writeFile(workbook, fileName);
          } catch (writeError: any) {
            throw new Error(`فشل إنشاء ملف Excel وتحميله: ${writeError.message || 'تأكد من صلاحيات المتصفح'}`);
          }
        }
      } catch (err: any) {
        console.error('Export error:', err);
        showToast(err.message || 'حدث خطأ تقني أثناء تصدير البيانات', 'error');
        return;
      }

      // Mark as exported
      const updatedItems = items.map(i => {
        if (targetItems.find(ti => ti.id === i.id)) return { ...i, isExported: true };
        return i;
      });
      updateItemsWithHistory(updatedItems);
      showToast('تم تصدير الملف بنجاح', 'success');
    } catch (error) {
      console.error("Export error:", error);
      showToast('حدث خطأ أثناء تصدير الملف', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] font-sans text-stone-900 flex flex-col max-w-md mx-auto shadow-2xl overflow-hidden relative border-x border-stone-200" dir="rtl">
      {/* Header */}
      <header className="bg-white border-b border-stone-100 px-6 pt-[max(env(safe-area-inset-top),1.25rem)] pb-5 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2">
          {view !== 'home' && (
            <button onClick={() => {
              if (isProcessing) {
                showToast('يرجى الانتظار حتى تنتهي المعالجة الحالية', 'error');
                return;
              }
              if (view === 'batch' && tasks.length > 0) {
                setConfirmModal({
                  show: true,
                  title: 'إلغاء الجلسة',
                  message: 'هل أنت متأكد من إلغاء هذه الجلسة؟ سيتم مسح جميع الصور غير المحفوظة.',
                  type: 'danger',
                  onConfirm: () => {
                    setTasks([]);
                    setView('home');
                    setConfirmModal(prev => ({ ...prev, show: false }));
                  }
                });
                return;
              }
              setView('home');
            }} className="p-1 -mr-2 ml-2">
              <ChevronLeft className="w-6 h-6 rotate-180" />
            </button>
          )}
          <h1 className="text-xl font-black tracking-tight text-indigo-950">ماسح <span className="text-indigo-600">المخزون</span></h1>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={undo} 
            disabled={history.length === 0}
            className={`p-2 rounded-xl transition-all active:scale-90 ${history.length === 0 ? 'text-stone-200' : 'text-stone-600 bg-stone-50 hover:bg-stone-100'}`}
            title="تراجع"
          >
            <Undo2 className="w-5 h-5" />
          </button>
          <button 
            onClick={redo} 
            disabled={redoStack.length === 0}
            className={`p-2 rounded-xl transition-all active:scale-90 ${redoStack.length === 0 ? 'text-stone-200' : 'text-stone-600 bg-stone-50 hover:bg-stone-100'}`}
            title="إعادة"
          >
            <Redo2 className="w-5 h-5" />
          </button>
          <button onClick={() => setView('settings')} className="p-2 bg-stone-50 rounded-xl transition-colors hover:bg-stone-100">
            <Settings className="w-5 h-5 text-stone-600" />
          </button>
        </div>
      </header>

      {/* Copyright Watermark */}
      <div className="fixed bottom-2 left-0 right-0 text-center pointer-events-none z-50 opacity-20 select-none">
        <p className="text-[9px] font-black text-indigo-950/20 uppercase tracking-[0.3em]">
          ORC Inventory Pro AI • Intellectual Property Protected • © {new Date().getFullYear()}
        </p>
      </div>

      <main className="flex-1 overflow-y-auto pb-24">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-6 space-y-6"
            >
              {/* Stats Card - Enhanced Dashboard */}
              <div className="bg-indigo-600 rounded-[3rem] p-8 text-white shadow-2xl shadow-indigo-200 relative overflow-hidden">
                <div className="relative z-10 space-y-6">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-indigo-100 text-[10px] font-black uppercase tracking-[0.2em] mb-1">إجمالي المخزون</p>
                      <h2 className="text-5xl font-black">{items.length} <span className="text-sm font-normal opacity-60">صنف</span></h2>
                    </div>
                    <div className="bg-white/10 backdrop-blur-xl p-3 rounded-2xl border border-white/10">
                      <LayoutGrid size={24} className="text-indigo-200" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/5 backdrop-blur-md p-4 rounded-[1.5rem] border border-white/5">
                      <p className="text-[9px] font-bold text-indigo-200 uppercase mb-1">إجمالي الأمتار</p>
                      <p className="text-xl font-black">{stats.totalMeters.toFixed(1)} <span className="text-[10px] font-normal opacity-60">M</span></p>
                    </div>
                    <div className="bg-white/5 backdrop-blur-md p-4 rounded-[1.5rem] border border-white/5">
                      <p className="text-[9px] font-bold text-indigo-200 uppercase mb-1">إجمالي الياردات</p>
                      <p className="text-xl font-black">{stats.totalYards.toFixed(1)} <span className="text-[10px] font-normal opacity-60">Y</span></p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-1 bg-emerald-500/20 backdrop-blur-md px-4 py-3 rounded-2xl border border-emerald-500/20 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-emerald-200">جديد</span>
                      <span className="font-black text-emerald-400">{stats.newItems}</span>
                    </div>
                    <div className="flex-1 bg-white/5 backdrop-blur-md px-4 py-3 rounded-2xl border border-white/5 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-indigo-200">مصدّر</span>
                      <span className="font-black text-white">{stats.exportedItems}</span>
                    </div>
                  </div>
                </div>
                <div className="absolute -right-20 -bottom-20 opacity-5 rotate-12">
                  <LayoutGrid size={300} />
                </div>
              </div>

              {/* Action Cards */}
              <div className="space-y-4">
                <label className="block cursor-pointer">
                  <input type="file" multiple accept="image/*" className="hidden" onChange={handleImagePick} disabled={isProcessing} />
                  <div className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm hover:shadow-xl transition-all flex items-center gap-5 group active:scale-95">
                    <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-all duration-300">
                      <Scan className="w-7 h-7" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-stone-800 text-lg">بدء مسح جماعي (AI)</h3>
                      <p className="text-xs text-stone-500">استخراج ITEM, COLOR, LENGTH تلقائياً</p>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-stone-50 flex items-center justify-center">
                      <ChevronLeft className="w-4 h-4 rotate-180 text-stone-300" />
                    </div>
                  </div>
                </label>

                <button 
                  onClick={() => setView('manual')}
                  className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm hover:shadow-xl transition-all flex items-center gap-5 group active:scale-95 w-full text-right"
                >
                  <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center group-hover:bg-amber-600 group-hover:text-white transition-all duration-300">
                    <Plus className="w-7 h-7" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-stone-800 text-lg">إضافة يدوية</h3>
                    <p className="text-xs text-stone-500">إدخال البيانات يدوياً عند عدم توفر ملصق</p>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-stone-50 flex items-center justify-center">
                    <ChevronLeft className="w-4 h-4 rotate-180 text-stone-300" />
                  </div>
                </button>
                <button 
                  onClick={() => setView('list')}
                  className="bg-white p-6 rounded-3xl border border-stone-100 shadow-sm hover:shadow-xl transition-all flex items-center gap-5 group active:scale-95 w-full text-right"
                >
                  <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-all duration-300">
                    <History className="w-7 h-7" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-stone-800 text-lg">السجلات والتصدير الذكي</h3>
                    <p className="text-xs text-stone-500">عرض الجلسات، البحث، وتصدير إكسل</p>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-stone-50 flex items-center justify-center">
                    <ChevronLeft className="w-4 h-4 rotate-180 text-stone-300" />
                  </div>
                </button>
              </div>

              {/* Recent Activity */}
              <div className="pt-2">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-bold text-stone-400 uppercase tracking-widest">آخر العمليات</h4>
                  <button onClick={() => setView('list')} className="text-xs text-indigo-600 font-bold">عرض الكل</button>
                </div>
                {items.slice(0, 3).map(item => (
                  <div key={item.id} className="bg-white p-4 rounded-2xl border border-stone-50 mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-stone-50 rounded-xl flex items-center justify-center text-stone-400">
                        <Scan size={18} />
                      </div>
                      <div>
                        <p className="font-bold text-sm">{item.code}</p>
                        <p className="text-[10px] text-stone-400">اللون: {item.colorNo} | {item.quantity}{item.unit}</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-stone-300">{new Date(item.createdAt).toLocaleDateString('ar-EG')}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {view === 'batch' && (
            <motion.div 
              key="batch"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-4 space-y-4"
            >
              <div className="flex items-center justify-between mb-2 px-2">
                <h2 className="text-lg font-bold">مراجعة الدفعة ({tasks.length})</h2>
                {!isProcessing && tasks.some(t => t.status === 'pending' || t.status === 'failed') && (
                  <button 
                    onClick={startBatchProcessing}
                    className="bg-indigo-600 text-white px-5 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-2 shadow-xl shadow-indigo-100 active:scale-95 transition-all"
                  >
                    <Play className="w-4 h-4" /> {tasks.some(t => t.status === 'failed') ? 'إعادة محاولة الفاشل' : 'بدء المعالجة'}
                  </button>
                )}
                {!isProcessing && !tasks.some(t => t.status === 'pending') && (
                  <button 
                    onClick={saveBatch}
                    className="bg-emerald-600 text-white px-5 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-2 shadow-xl shadow-emerald-100"
                  >
                    <Save className="w-4 h-4" /> اعتماد الجلسة
                  </button>
                )}
              </div>

              {isProcessing && batchProgress.total > 0 && (
                <div className="mb-4 px-2">
                  <div className="flex justify-between text-xs font-bold text-stone-500 mb-2">
                    <span>جاري المعالجة...</span>
                    <span>{batchProgress.current} / {batchProgress.total}</span>
                  </div>
                  <div className="h-3 bg-stone-100 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-indigo-600 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {tasks.map((task, index) => (
                  <div 
                    key={task.id}
                    className={`bg-white p-4 rounded-3xl border-2 transition-all flex items-center gap-4 ${
                      task.status === 'failed' ? 'border-red-100 bg-red-50/30' : 
                      task.status === 'success' ? 'border-emerald-100' : 'border-stone-100'
                    }`}
                  >
                    {task.status === 'pending' && !isProcessing && (
                      <div className="flex flex-col gap-1">
                        <button onClick={() => moveTask(index, 'up')} disabled={index === 0} className="p-1 text-stone-400 hover:text-indigo-600 disabled:opacity-30"><ChevronUp size={18} /></button>
                        <button onClick={() => moveTask(index, 'down')} disabled={index === tasks.length - 1} className="p-1 text-stone-400 hover:text-indigo-600 disabled:opacity-30"><ChevronDown size={18} /></button>
                      </div>
                    )}
                    <div 
                      className="w-16 h-16 rounded-2xl overflow-hidden border border-stone-100 flex-shrink-0 cursor-pointer"
                      onClick={() => {
                        if (task.status === 'pending' || task.status === 'processing') return;
                        setEditingTask(task);
                      }}
                    >
                      <img src={task.image} alt="Label" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </div>
                    <div 
                      className="flex-1 min-w-0 cursor-pointer relative"
                      onClick={() => {
                        if (task.status === 'pending' || task.status === 'processing') return;
                        setEditingTask(task);
                      }}
                    >
                      {task.status === 'processing' ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-indigo-600 text-sm font-bold">
                            <Loader2 className="w-4 h-4 animate-spin" /> جاري التحليل...
                          </div>
                          <div className="h-1 bg-indigo-100 rounded-full overflow-hidden">
                            <motion.div 
                              className="h-full bg-indigo-600"
                              animate={{ x: ["-100%", "100%"] }}
                              transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                            />
                          </div>
                        </div>
                      ) : task.status === 'pending' ? (
                        <div className="text-sm font-bold text-stone-400 italic">في الانتظار...</div>
                      ) : (
                        <>
                          <div className={`font-bold truncate ${task.status === 'failed' ? 'text-red-600' : 'text-stone-800'}`}>
                            {task.result?.itemNo || (task.status === 'failed' ? 'فشلت المعالجة' : 'بيانات مفقودة - انقر للتصحيح')}
                          </div>
                          {task.status === 'success' && task.result && (
                            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-black text-stone-400 uppercase">Color:</span>
                                <span className="text-[11px] font-black text-indigo-600">{task.result.colorNo || '-'}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-black text-stone-400 uppercase">Qty:</span>
                                <span className="text-[11px] font-black text-emerald-600">{task.result.length} {task.result.unit}</span>
                              </div>
                              {task.result.notes && (
                                <div className="w-full flex items-center gap-1 border-t border-stone-50 pt-1 mt-1">
                                  <span className="text-[9px] font-black text-amber-500 uppercase">Info:</span>
                                  <span className="text-[10px] font-bold text-stone-500 truncate">{task.result.notes}</span>
                                </div>
                              )}
                            </div>
                          )}
                          {task.error ? (
                            <div className="text-[10px] text-red-400 font-medium mt-1 leading-tight">{task.error}</div>
                          ) : (
                            <div className="text-xs text-stone-500 flex gap-3 mt-1">
                              <span className="bg-stone-50 px-2 py-0.5 rounded-md border border-stone-100/50">اللون: {task.result?.colorNo || '-'}</span>
                              <span className="bg-stone-50 px-2 py-0.5 rounded-md border border-stone-100/50">الكمية: {task.result?.length || '-'}{task.result?.unit || 'M'}</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {task.status === 'success' && <CheckCircle2 className="w-6 h-6 text-emerald-500" />}
                      {task.status === 'failed' && <AlertCircle className="w-6 h-6 text-red-500" />}
                      {task.status === 'pending' && !isProcessing && (
                        <button onClick={() => removeTask(task.id)} className="p-2 text-red-400 hover:text-red-600 bg-red-50 rounded-xl transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {view === 'list' && (
            <motion.div 
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-4 space-y-4 pb-32"
            >
                <div className="flex items-center justify-between mb-4 px-2">
                  <h2 className="text-lg font-bold">السجلات والتصدير</h2>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setView('home')}
                      className="bg-stone-50 text-stone-400 p-3 rounded-2xl active:scale-95 transition-all"
                    >
                      <ChevronLeft className="w-5 h-5 rotate-180" />
                    </button>
                    <button 
                      onClick={() => exportToExcel('SESSION')}
                      className="bg-white border border-stone-100 text-indigo-600 p-3 rounded-2xl shadow-sm hover:bg-indigo-50 transition-all active:scale-95"
                      title="تصدير آخر جلسة"
                    >
                      <Filter className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={() => exportToExcel('NEW')}
                      className="bg-white border border-stone-100 text-orange-600 p-3 rounded-2xl shadow-sm hover:bg-orange-50 transition-all active:scale-95"
                      title="تصدير الجديد فقط"
                    >
                      <History className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={() => exportToExcel('ALL')}
                      className="bg-emerald-600 text-white p-3 rounded-2xl shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-95"
                      title="تصدير الكل"
                    >
                      <FileSpreadsheet className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Search Bar in List View */}
                <div className="relative px-2">
                  <Search className="absolute right-6 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                  <input 
                    type="text"
                    placeholder="بحث بالكود أو اللون..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white border border-stone-100 rounded-2xl px-12 py-4 outline-none font-bold shadow-sm focus:ring-4 focus:ring-indigo-500/5 transition-all"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute left-6 top-1/2 -translate-y-1/2 p-1 bg-stone-50 rounded-full text-stone-400"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

              {/* Search Bar */}
              <div className="px-2 mb-6">
                <div className="relative">
                  <input 
                    type="text"
                    placeholder="بحث بالكود أو اللون..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white border border-stone-100 rounded-2xl px-12 py-4 shadow-sm outline-none focus:ring-2 ring-indigo-500/20 transition-all font-bold text-sm"
                  />
                  <Scan className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-300 w-5 h-5" />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 p-2 transition-colors"
                      title="مسح البحث"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {filteredItems.length === 0 ? (
                <div className="text-center py-24 text-stone-300">
                  <History className="w-16 h-16 mx-auto mb-4 opacity-20" />
                  <p className="font-bold">لا توجد سجلات مطابقة</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredItems.map((item) => (
                    <div key={item.id} className="bg-white p-5 rounded-3xl border border-stone-100 flex items-center justify-between shadow-sm">
                      <div>
                        <div className="font-bold text-stone-800 text-lg">{item.code}</div>
                        <div className="text-xs text-stone-500 mt-1">
                          اللون: <span className="font-bold text-stone-700">{item.colorNo}</span> | الكمية: <span className="font-bold text-stone-700">{item.quantity} {item.unit}</span>
                        </div>
                        {item.notes && (
                          <div className="text-[10px] text-stone-400 mt-1 italic">
                            ملاحظات: {item.notes}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-bold">{item.sessionId.split('_')[0]}</span>
                          <span className="text-[10px] text-stone-300">{new Date(item.createdAt).toLocaleString('ar-EG')}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {item.isExported && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                        <button 
                          onClick={() => setEditingSavedItem(item)}
                          className="text-stone-300 hover:text-indigo-600 p-2 transition-colors"
                          title="تعديل السجل"
                        >
                          <Edit2 className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => {
                            setConfirmModal({
                              show: true,
                              title: 'حذف السجل',
                              message: 'هل أنت متأكد من حذف هذا السجل؟',
                              type: 'danger',
                              onConfirm: () => {
                                updateItemsWithHistory(items.filter(i => i.id !== item.id));
                                setConfirmModal(prev => ({ ...prev, show: false }));
                              }
                            });
                          }}
                          className="text-red-200 hover:text-red-500 p-2 transition-colors"
                          title="حذف السجل"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {view === 'manual' && (
            <motion.div 
              key="manual"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              className="p-6 space-y-6"
            >
              <div className="text-center mb-4">
                <div className="w-20 h-20 bg-amber-50 rounded-[2rem] mx-auto flex items-center justify-center text-amber-600 mb-4 shadow-xl shadow-amber-50">
                  <Plus size={32} />
                </div>
                <h2 className="text-xl font-bold">إضافة يدوية</h2>
                <p className="text-stone-400 text-sm">أدخل بيانات الصنف بدقة</p>
              </div>

              <div className="bg-white p-6 rounded-[2.5rem] border border-stone-100 shadow-xl shadow-stone-100/50 space-y-5">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-stone-400 uppercase mr-1">كود الصنف (ITEM NO)</label>
                  <div className="relative">
                    <input 
                      type="text"
                      placeholder="مثال: ART 1234"
                      value={manualItem.code}
                      onChange={(e) => setManualItem({...manualItem, code: e.target.value})}
                      className={`w-full bg-stone-50 border ${manualItem.code.length < 2 ? 'border-red-200 focus:ring-red-500/10' : 'border-stone-100 focus:ring-indigo-500/10'} rounded-2xl px-5 py-4 outline-none font-bold transition-all`}
                    />
                    {manualItem.code && (
                      <button 
                        onClick={() => setManualItem({...manualItem, code: ''})}
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-500 p-1"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-stone-400 uppercase mr-1">رقم اللون (COLOR NO)</label>
                  <div className="relative">
                    <input 
                      type="text"
                      placeholder="مثال: COL 55"
                      value={manualItem.colorNo}
                      onChange={(e) => setManualItem({...manualItem, colorNo: e.target.value})}
                      className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-5 py-4 focus:ring-4 ring-indigo-500/10 outline-none font-bold transition-all"
                    />
                    {manualItem.colorNo && (
                      <button 
                        onClick={() => setManualItem({...manualItem, colorNo: ''})}
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-500 p-1"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-stone-400 uppercase mr-1">الكمية</label>
                    <div className="relative">
                      <input 
                        type="number"
                        placeholder="0.00"
                        value={manualItem.quantity || ''}
                        onChange={(e) => setManualItem({...manualItem, quantity: parseFloat(e.target.value)})}
                        className={`w-full bg-stone-50 border ${manualItem.quantity <= 0 ? 'border-red-200 focus:ring-red-500/10' : 'border-stone-100 focus:ring-indigo-500/10'} rounded-2xl px-5 py-4 outline-none font-bold transition-all`}
                      />
                      {manualItem.quantity > 0 && (
                        <button 
                          onClick={() => setManualItem({...manualItem, quantity: 0})}
                          className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-500 p-1"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-stone-400 uppercase mr-1">الوحدة</label>
                    <select 
                      value={manualItem.unit}
                      onChange={(e) => setManualItem({...manualItem, unit: e.target.value})}
                      className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-5 py-4 focus:ring-4 ring-indigo-500/10 outline-none font-bold transition-all"
                    >
                      <option value="M">متر (M)</option>
                      <option value="KG">كيلو (KG)</option>
                      <option value="PCS">قطعة (PCS)</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-stone-400 uppercase mr-1">ملاحظات</label>
                  <div className="relative">
                    <textarea 
                      placeholder="أضف ملاحظات إضافية هنا..."
                      value={manualItem.notes}
                      onChange={(e) => setManualItem({...manualItem, notes: e.target.value})}
                      className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-5 py-4 focus:ring-4 ring-indigo-500/10 outline-none font-bold transition-all h-24 resize-none"
                    />
                    {manualItem.notes && (
                      <button 
                        onClick={() => setManualItem({...manualItem, notes: ''})}
                        className="absolute left-4 top-4 text-stone-300 hover:text-stone-500 p-1"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button 
                    onClick={() => {
                      setManualItem({ code: '', colorNo: '', quantity: 0, unit: 'M', notes: '' });
                      setView('home');
                    }}
                    className="flex-1 bg-stone-50 text-stone-400 font-bold py-5 rounded-[1.5rem] active:scale-95 transition-all"
                  >
                    إلغاء
                  </button>
                  <button 
                    onClick={saveManualItem}
                    className="flex-[2] bg-indigo-600 text-white font-bold py-5 rounded-[1.5rem] shadow-2xl shadow-indigo-200 flex items-center justify-center gap-3 active:scale-95 transition-all"
                  >
                    <Save className="w-5 h-5" /> حفظ الصنف
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-6 space-y-8"
            >
              <div className="text-center">
                <div className="w-24 h-24 bg-indigo-600 rounded-[2.5rem] mx-auto flex items-center justify-center text-white mb-4 shadow-2xl shadow-indigo-100">
                  <Settings size={40} />
                </div>
                <h2 className="text-xl font-bold">الإعدادات</h2>
                <p className="text-stone-400 text-sm">تخصيص تجربة الاستخدام</p>
              </div>

              <div className="bg-white rounded-3xl border border-stone-100 overflow-hidden">
                <div className="p-5 border-b border-stone-50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-stone-50 rounded-xl flex items-center justify-center text-stone-400"><Share2 size={18} /></div>
                    <span className="font-bold">مشاركة البيانات</span>
                  </div>
                  <ChevronLeft className="w-4 h-4 rotate-180 text-stone-300" />
                </div>
                <div className="p-5 border-b border-stone-50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-stone-50 rounded-xl flex items-center justify-center text-stone-400"><Download size={18} /></div>
                    <span className="font-bold">تحديث التطبيق (PWA)</span>
                  </div>
                  <button onClick={() => {
                    if ('serviceWorker' in navigator) {
                      navigator.serviceWorker.getRegistrations().then(registrations => {
                        registrations.forEach(registration => registration.update());
                        setConfirmModal({
                          show: true,
                          title: 'تحديث التطبيق',
                          message: 'تم التحقق من التحديثات. إذا كان هناك تحديث متاح، سيتم تحميله تلقائياً.',
                          type: 'success',
                          onConfirm: () => setConfirmModal(prev => ({ ...prev, show: false }))
                        });
                      }).catch(console.error);
                    }
                  }} className="text-xs font-bold text-indigo-600">تحديث</button>
                </div>
                <div className="p-5 border-b border-stone-50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center text-red-400"><Trash2 size={18} /></div>
                    <span className="font-bold text-red-500">مسح كافة السجلات</span>
                  </div>
                  <button onClick={clearAllData} className="text-xs font-bold text-red-600">مسح</button>
                </div>
              </div>

              <div className="text-center space-y-2">
                <p className="text-[10px] font-black text-stone-300 uppercase tracking-[0.3em]">ORC Inventory Pro AI</p>
                <p className="text-[9px] font-bold text-stone-200 uppercase tracking-widest">Version 2.5.0 • Enterprise Edition</p>
              </div>

              <div className="bg-white p-8 rounded-[3rem] shadow-xl shadow-indigo-50 border border-stone-50 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
                <div className="relative flex flex-col items-center text-center">
                  <div className="w-24 h-24 rounded-[2rem] overflow-hidden mb-6 border-4 border-white shadow-2xl">
                    <img src="/developer.jpg" alt="Developer" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).src = 'https://i.ibb.co/LhY0mYf/developer.jpg'; }} />
                  </div>
                  <p className="text-[10px] text-indigo-400 font-black uppercase tracking-[0.2em] mb-2">Developed By</p>
                  <h3 className="text-2xl font-black text-indigo-950 mb-1">المهندس باسل أشرف</h3>
                  <p className="text-stone-400 font-bold mb-6">Full Stack Developer & AI Specialist</p>
                  
                  <div className="flex gap-4 w-full">
                    <a href="tel:01014543845" className="flex-1 bg-stone-50 hover:bg-indigo-50 text-stone-600 hover:text-indigo-600 p-4 rounded-2xl flex items-center justify-center gap-2 transition-all group/btn">
                      <Phone size={18} className="group-hover/btn:rotate-12 transition-transform" />
                      <span className="font-bold text-sm">اتصال</span>
                    </a>
                    <a href="#" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-100 transition-all">
                      <ExternalLink size={18} />
                      <span className="font-bold text-sm">الملف الشخصي</span>
                    </a>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Quick Edit Modal */}
      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-indigo-950/80 backdrop-blur-md">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            className="bg-white w-full max-w-sm rounded-[2.5rem] overflow-hidden shadow-2xl"
          >
            <div className="p-6 border-b border-stone-100 flex items-center justify-between">
              <h3 className="font-bold text-lg">تعديل بيانات الملصق</h3>
              <button onClick={() => setEditingTask(null)} className="p-2 bg-stone-50 rounded-full"><X className="w-5 h-5 text-stone-400" /></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="h-52 bg-stone-100 rounded-3xl overflow-hidden relative group border border-stone-200">
                <div className="absolute inset-0 overflow-auto">
                   <img 
                    src={editingTask.image} 
                    alt="Zoom" 
                    onClick={() => setZoomedImage(editingTask.image)}
                    className="w-full h-full object-contain transition-transform duration-300 hover:scale-150 cursor-zoom-in" 
                    referrerPolicy="no-referrer" 
                  />
                </div>
                <div className="absolute bottom-3 right-3 bg-white/80 backdrop-blur px-3 py-1 rounded-full text-[10px] font-bold text-stone-500 flex items-center gap-1 pointer-events-none">
                  <ZoomIn size={12} /> اضغط للتكبير
                </div>
              </div>
              
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-stone-400 uppercase mr-1">ITEM NO</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      placeholder="أدخل كود الصنف"
                      value={editingTask.result?.itemNo || ''} 
                      onChange={(e) => {
                        const updated = { ...editingTask, result: { ...(editingTask.result || { itemNo: '', colorNo: '', length: '', unit: 'M', notes: '' }), itemNo: e.target.value } };
                        setEditingTask(updated);
                      }}
                      className={`w-full bg-stone-50 border ${(editingTask.result?.itemNo || '').length < 2 ? 'border-red-200 focus:ring-red-500/10' : 'border-stone-100 focus:ring-indigo-500/10'} rounded-2xl px-5 py-4 outline-none font-bold transition-all`}
                    />
                    {editingTask.result?.itemNo && (
                      <button 
                        onClick={() => {
                          const updated = { ...editingTask, result: { ...(editingTask.result || { itemNo: '', colorNo: '', length: '', unit: 'M', notes: '' }), itemNo: '' } };
                          setEditingTask(updated);
                        }}
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-500 p-1"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-stone-400 uppercase mr-1">COLOR NO</label>
                    <div className="relative">
                      <input 
                        type="text" 
                        placeholder="اللون"
                        value={editingTask.result?.colorNo || ''} 
                        onChange={(e) => {
                          const updated = { ...editingTask, result: { ...(editingTask.result || { itemNo: '', colorNo: '', length: '', unit: 'M', notes: '' }), colorNo: e.target.value } };
                          setEditingTask(updated);
                        }}
                        className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-5 py-4 focus:ring-4 ring-indigo-500/10 outline-none font-bold transition-all"
                      />
                      {editingTask.result?.colorNo && (
                        <button 
                          onClick={() => {
                            const updated = { ...editingTask, result: { ...(editingTask.result || { itemNo: '', colorNo: '', length: '', unit: 'M', notes: '' }), colorNo: '' } };
                            setEditingTask(updated);
                          }}
                          className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-500 p-1"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-stone-400 uppercase mr-1">LENGTH</label>
                    <div className="relative">
                      <input 
                        type="text" 
                        placeholder="الطول"
                        value={editingTask.result?.length || ''} 
                        onChange={(e) => {
                          const updated = { ...editingTask, result: { ...(editingTask.result || { itemNo: '', colorNo: '', length: '', unit: 'M', notes: '' }), length: e.target.value } };
                          setEditingTask(updated);
                        }}
                        className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-5 py-4 focus:ring-4 ring-indigo-500/10 outline-none font-bold transition-all"
                      />
                      {editingTask.result?.length && (
                        <button 
                          onClick={() => {
                            const updated = { ...editingTask, result: { ...(editingTask.result || { itemNo: '', colorNo: '', length: '', unit: 'M', notes: '' }), length: '' } };
                            setEditingTask(updated);
                          }}
                          className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-500 p-1"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-stone-400 uppercase mr-1">الوحدة</label>
                    <select 
                      value={editingTask.result?.unit || 'M'}
                      onChange={(e) => {
                        const updated = { ...editingTask, result: { ...(editingTask.result || { itemNo: '', colorNo: '', length: '', unit: 'M', notes: '' }), unit: e.target.value } };
                        setEditingTask(updated);
                      }}
                      className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-5 py-4 focus:ring-4 ring-indigo-500/10 outline-none font-bold transition-all appearance-none"
                    >
                      <option value="M">M (متر)</option>
                      <option value="Yard">Yard (ياردة)</option>
                      <option value="Roll">Roll (رول)</option>
                      <option value="Piece">Piece (قطعة)</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-stone-400 uppercase mr-1">ملاحظات</label>
                    <div className="relative">
                      <input 
                        type="text" 
                        placeholder="ملاحظات..."
                        value={editingTask.result?.notes || ''}
                        onChange={(e) => {
                          const updated = { ...editingTask, result: { ...(editingTask.result || { itemNo: '', colorNo: '', length: '', unit: 'M', notes: '' }), notes: e.target.value } };
                          setEditingTask(updated);
                        }}
                        className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-5 py-4 focus:ring-4 ring-indigo-500/10 outline-none font-bold transition-all"
                      />
                      {editingTask.result?.notes && (
                        <button 
                          onClick={() => {
                            const updated = { ...editingTask, result: { ...(editingTask.result || { itemNo: '', colorNo: '', length: '', unit: 'M', notes: '' }), notes: '' } };
                            setEditingTask(updated);
                          }}
                          className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-500 p-1"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => {
                  const code = editingTask.result?.itemNo?.trim();
                  const quantity = parseFloat(editingTask.result?.length || '0');

                  if (!code || code.length < 2) {
                    showToast('كود الصنف يجب أن يكون حرفين على الأقل', 'error');
                    return;
                  }
                  if (isNaN(quantity) || quantity <= 0) {
                    showToast('الكمية يجب أن تكون رقماً أكبر من صفر', 'error');
                    return;
                  }

                  const updatedTasks = tasks.map(t => t.id === editingTask.id ? { 
                    ...editingTask, 
                    result: { ...editingTask.result!, itemNo: code.toUpperCase(), length: String(quantity) },
                    status: 'success' as const,
                    error: undefined 
                  } : t);
                  setTasks(updatedTasks);
                  setEditingTask(null);
                  showToast('تم اعتماد البيانات بنجاح', 'success');
                }}
                className="w-full bg-indigo-600 text-white font-bold py-5 rounded-[1.5rem] shadow-2xl shadow-indigo-200 flex items-center justify-center gap-3 active:scale-95 transition-all"
              >
                <CheckCircle2 className="w-5 h-5" /> اعتماد البيانات
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Edit Saved Item Modal */}
      {editingSavedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-indigo-950/80 backdrop-blur-md">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            className="bg-white w-full max-w-sm rounded-[2.5rem] overflow-hidden shadow-2xl"
          >
            <div className="p-6 border-b border-stone-100 flex items-center justify-between">
              <h3 className="font-bold text-lg">تعديل بيانات الصنف</h3>
              <button onClick={() => setEditingSavedItem(null)} className="p-2 bg-stone-50 rounded-full"><X className="w-5 h-5 text-stone-400" /></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-stone-400 uppercase mr-1">ITEM NO</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      placeholder="أدخل كود الصنف"
                      value={editingSavedItem.code} 
                      onChange={(e) => setEditingSavedItem({ ...editingSavedItem, code: e.target.value })}
                      className={`w-full bg-stone-50 border ${editingSavedItem.code.length < 2 ? 'border-red-200 focus:ring-red-500/10' : 'border-stone-100 focus:ring-indigo-500/10'} rounded-2xl px-5 py-4 outline-none font-bold transition-all`}
                    />
                    {editingSavedItem.code && (
                      <button 
                        onClick={() => setEditingSavedItem({ ...editingSavedItem, code: '' })}
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-500 p-1"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-stone-400 uppercase mr-1">COLOR NO</label>
                    <div className="relative">
                      <input 
                        type="text" 
                        placeholder="اللون"
                        value={editingSavedItem.colorNo} 
                        onChange={(e) => setEditingSavedItem({ ...editingSavedItem, colorNo: e.target.value })}
                        className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-5 py-4 focus:ring-4 ring-indigo-500/10 outline-none font-bold transition-all"
                      />
                      {editingSavedItem.colorNo && (
                        <button 
                          onClick={() => setEditingSavedItem({ ...editingSavedItem, colorNo: '' })}
                          className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-500 p-1"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-stone-400 uppercase mr-1">LENGTH</label>
                    <div className="relative">
                      <input 
                        type="number" 
                        placeholder="الطول"
                        value={editingSavedItem.quantity || ''} 
                        onChange={(e) => setEditingSavedItem({ ...editingSavedItem, quantity: parseFloat(e.target.value) || 0 })}
                        className={`w-full bg-stone-50 border ${editingSavedItem.quantity <= 0 ? 'border-red-200 focus:ring-red-500/10' : 'border-stone-100 focus:ring-indigo-500/10'} rounded-2xl px-5 py-4 outline-none font-bold transition-all`}
                      />
                      {editingSavedItem.quantity > 0 && (
                        <button 
                          onClick={() => setEditingSavedItem({ ...editingSavedItem, quantity: 0 })}
                          className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-500 p-1"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-stone-400 uppercase mr-1">الوحدة</label>
                    <select 
                      value={editingSavedItem.unit}
                      onChange={(e) => setEditingSavedItem({ ...editingSavedItem, unit: e.target.value })}
                      className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-5 py-4 focus:ring-4 ring-indigo-500/10 outline-none font-bold transition-all appearance-none"
                    >
                      <option value="M">M (متر)</option>
                      <option value="Yard">Yard (ياردة)</option>
                      <option value="Roll">Roll (رول)</option>
                      <option value="Piece">Piece (قطعة)</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-stone-400 uppercase mr-1">ملاحظات</label>
                    <div className="relative">
                      <input 
                        type="text" 
                        placeholder="ملاحظات..."
                        value={editingSavedItem.notes || ''}
                        onChange={(e) => setEditingSavedItem({ ...editingSavedItem, notes: e.target.value })}
                        className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-5 py-4 focus:ring-4 ring-indigo-500/10 outline-none font-bold transition-all"
                      />
                      {editingSavedItem.notes && (
                        <button 
                          onClick={() => setEditingSavedItem({ ...editingSavedItem, notes: '' })}
                          className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-500 p-1"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => {
                  const code = editingSavedItem.code?.trim();
                  const quantity = parseFloat(String(editingSavedItem.quantity));

                  if (!code || code.length < 2) {
                    showToast('كود الصنف يجب أن يكون حرفين على الأقل', 'error');
                    return;
                  }
                  if (isNaN(quantity) || quantity <= 0) {
                    showToast('الكمية يجب أن تكون رقماً أكبر من صفر', 'error');
                    return;
                  }

                  const updatedItems = items.map(i => i.id === editingSavedItem.id ? {
                    ...editingSavedItem,
                    code: code.toUpperCase(),
                    colorNo: (editingSavedItem.colorNo || '').trim().toUpperCase(),
                    quantity: quantity
                  } : i);
                  updateItemsWithHistory(updatedItems);
                  setEditingSavedItem(null);
                  showToast('تم تعديل الصنف بنجاح', 'success');
                }}
                className="w-full bg-indigo-600 text-white font-bold py-5 rounded-[1.5rem] shadow-2xl shadow-indigo-200 flex items-center justify-center gap-3 active:scale-95 transition-all"
              >
                <Save className="w-5 h-5" /> حفظ التعديلات
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Toast Notification */}
      <AnimatePresence>
        {toast.show && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={`fixed bottom-28 left-6 right-6 z-[120] p-4 rounded-2xl shadow-2xl flex items-center gap-3 border ${
              toast.type === 'success' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-red-600 border-red-500 text-white'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            <span className="font-bold text-sm">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image Zoom Modal */}
      <AnimatePresence>
        {zoomedImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setZoomedImage(null)}
            className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4 cursor-zoom-out"
          >
            <motion.img 
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              src={zoomedImage} 
              className="max-w-full max-h-full object-contain rounded-xl"
              referrerPolicy="no-referrer"
            />
            <button className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors">
              <X size={24} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Professional Confirmation Modal */}
      <AnimatePresence>
        {confirmModal.show && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-indigo-950/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-xs rounded-[2.5rem] overflow-hidden shadow-2xl border border-stone-100"
            >
              <div className="p-8 text-center">
                <div className={`w-16 h-16 mx-auto rounded-3xl flex items-center justify-center mb-6 ${
                  confirmModal.type === 'danger' ? 'bg-red-50 text-red-500' : 
                  confirmModal.type === 'success' ? 'bg-emerald-50 text-emerald-500' : 
                  'bg-indigo-50 text-indigo-500'
                }`}>
                  {confirmModal.type === 'danger' ? <Trash2 size={32} /> : 
                   confirmModal.type === 'success' ? <CheckCircle2 size={32} /> : 
                   <AlertCircle size={32} />}
                </div>
                <h3 className="text-xl font-black text-indigo-950 mb-2">{confirmModal.title}</h3>
                <p className="text-stone-400 font-bold text-sm leading-relaxed">{confirmModal.message}</p>
              </div>
              <div className="p-4 bg-stone-50 flex gap-3">
                {confirmModal.type === 'info' ? (
                  <button 
                    onClick={() => {
                      confirmModal.onConfirm();
                      setConfirmModal(prev => ({ ...prev, show: false }));
                    }}
                    className="flex-1 py-4 rounded-2xl font-bold text-white bg-indigo-600 shadow-lg shadow-indigo-100 transition-all active:scale-95"
                  >
                    حسناً
                  </button>
                ) : (
                  <>
                    <button 
                      onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
                      className="flex-1 py-4 rounded-2xl font-bold text-stone-400 hover:bg-stone-100 transition-colors"
                    >
                      إلغاء
                    </button>
                    <button 
                      onClick={confirmModal.onConfirm}
                      className={`flex-1 py-4 rounded-2xl font-bold text-white shadow-lg transition-all active:scale-95 ${
                        confirmModal.type === 'danger' ? 'bg-red-500 shadow-red-100' : 
                        'bg-emerald-500 shadow-emerald-100'
                      }`}
                    >
                      تأكيد
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Navigation Bar */}
      <nav className="bg-white/90 backdrop-blur-xl border-t border-stone-100 px-8 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] flex items-center justify-between fixed bottom-0 left-0 right-0 max-w-md mx-auto z-30 rounded-t-[2.5rem] shadow-[0_-10px_40px_rgba(0,0,0,0.03)]">
        {[
          { id: 'home', icon: Scan, label: 'مسح', activeViews: ['home', 'batch', 'manual'] },
          { id: 'list', icon: History, label: 'السجل', activeViews: ['list'] },
          { id: 'settings', icon: Settings, label: 'إعدادات', activeViews: ['settings'] }
        ].map((tab) => {
          const isActive = tab.activeViews.includes(view);
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setView(tab.id as any)}
              className={`relative flex flex-col items-center justify-center w-20 h-14 transition-colors ${isActive ? 'text-indigo-600' : 'text-stone-400 hover:text-stone-600'}`}
            >
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute inset-0 bg-indigo-50/80 rounded-2xl -z-10"
                  transition={{ type: "spring", bounce: 0.25, duration: 0.5 }}
                />
              )}
              <Icon className={`w-6 h-6 transition-transform duration-300 ${isActive ? '-translate-y-1 scale-110' : 'scale-100'}`} />
              <span className={`text-[11px] font-bold absolute bottom-1.5 transition-all duration-300 ${isActive ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
