import { useGameStore } from '../state/gameStore';
import { playClickSound, playCloseSound } from '../utils/sounds';

interface ConfirmModalState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
  confirmColor?: 'red' | 'green' | 'amber';
}

export function ConfirmModal() {
  const confirmModal = useGameStore(state => state.confirmModal);
  const setConfirmModal = useGameStore(state => state.setConfirmModal);

  if (!confirmModal?.isOpen) return null;

  const handleConfirm = () => {
    playClickSound();
    confirmModal.onConfirm();
    setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  };

  const handleCancel = () => {
    playCloseSound();
    if (confirmModal.onCancel) {
      confirmModal.onCancel();
    }
    setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  };

  const confirmColorClass = confirmModal.confirmColor === 'red'
    ? 'bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400'
    : confirmModal.confirmColor === 'green'
    ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400'
    : 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400';

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-gray-900 rounded-xl border-2 border-gray-700 shadow-2xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gradient-to-r from-gray-800/50 to-gray-900/50">
          <h2 className="text-lg font-pixel text-gray-200">{confirmModal.title}</h2>
          <button
            onClick={handleCancel}
            className="p-1 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-gray-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Message */}
        <div className="p-6">
          <p className="text-gray-300 font-pixel text-sm leading-relaxed">{confirmModal.message}</p>
        </div>

        {/* Buttons */}
        <div className="flex gap-3 p-4 border-t border-gray-700 bg-gray-800/30">
          <button
            onClick={handleCancel}
            className="flex-1 py-2.5 rounded-lg font-pixel text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 transition-all"
          >
            {confirmModal.cancelText || 'Cancel'}
          </button>
          <button
            onClick={handleConfirm}
            className={`flex-1 py-2.5 rounded-lg font-pixel text-sm text-white shadow-lg transition-all ${confirmColorClass}`}
          >
            {confirmModal.confirmText || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
