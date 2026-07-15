// Drag & Drop Handler for Reordering Sections and List Items in ResumeMkr

export function initDragAndDrop(containerSelector, itemSelector, handleSelector, onReorderedCallback) {
  const container = document.querySelector(containerSelector);
  if (!container) return;

  let dragEl = null;

  container.addEventListener('dragstart', (e) => {
    const handle = e.target.closest(handleSelector);
    const item = e.target.closest(itemSelector);

    // Only allow dragging if the user initiated the drag on the handle element
    if (!handle || !item) {
      e.preventDefault();
      return;
    }

    dragEl = item;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', item.innerHTML);
    item.classList.add('opacity-40', 'border-dashed', 'border-indigo-400');
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const targetItem = e.target.closest(itemSelector);
    if (targetItem && targetItem !== dragEl) {
      const rect = targetItem.getBoundingClientRect();
      const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
      container.insertBefore(dragEl, next ? targetItem.nextSibling : targetItem);
    }
  });

  container.addEventListener('dragend', () => {
    if (dragEl) {
      dragEl.classList.remove('opacity-40', 'border-dashed', 'border-indigo-400');
      dragEl = null;
      
      // Extract new sequence order from DOM and callback
      const items = Array.from(container.querySelectorAll(itemSelector));
      const orderIds = items.map(item => item.getAttribute('data-id') || item.id);
      
      if (onReorderedCallback) {
        onReorderedCallback(orderIds);
      }
    }
  });
}
