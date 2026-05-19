/**
 * pipelineEvents -- thin window-level event bus for "the pipeline data
 * just changed" notifications.
 *
 * Any component that writes a proposal or enquiry should call
 * notifyPipelineChanged() so subscribers (currently PipelinePage) can
 * refetch. Lets us refresh the Kanban from anywhere (FAB, enquiry form,
 * card-level send dialogs) without prop-drilling refresh callbacks
 * through several layers of modals.
 */

const EVENT = 'pipeline:changed';

export function notifyPipelineChanged() {
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onPipelineChanged(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
