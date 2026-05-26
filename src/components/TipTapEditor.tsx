/**
 * TipTapEditor -- minimal rich-text editor used by the guidebook
 * admin editor for body_html fields. Toolbar is intentionally tight
 * (bold, italic, link, lists, paragraph) so pasted styles don't leak
 * — TipTap's StarterKit handles this for us as long as we DON'T
 * include extensions that re-introduce them.
 *
 * Output is sanitised HTML on the way out (DOMPurify-friendly).
 */

import { useEffect } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';

export type TipTapEditorProps = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
};

export default function TipTapEditor({ value, onChange, placeholder }: TipTapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Drop the default heading sizes — body cards don't need <h1>.
        // Allow up to <h3> for sub-sections.
        heading: { levels: [3] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
    ],
    content: value || '',
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  // Keep external `value` changes (e.g. when the parent loads a
  // different card) reflected in the editor.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== (value || '')) {
      editor.commands.setContent(value || '');
    }
  }, [value, editor]);

  if (!editor) return <div className="tiptap-empty">Loading editor…</div>;

  return (
    <div className="tiptap-wrap">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="tiptap-content" placeholder={placeholder} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  function setLink() {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL (leave blank to remove):', previous || '');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  const btn = (active: boolean, onClick: () => void, label: string, title: string) => (
    <button
      type="button"
      className={`tiptap-toolbar-btn ${active ? 'is-active' : ''}`}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      aria-pressed={active}
      title={title}
    >
      {label}
    </button>
  );

  return (
    <div className="tiptap-toolbar" role="toolbar" aria-label="Formatting">
      {btn(editor.isActive('bold'),   () => editor.chain().focus().toggleBold().run(),   'B',   'Bold (⌘B)')}
      {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'I',   'Italic (⌘I)')}
      {btn(editor.isActive('link'),   setLink,                                            '↗',   'Link')}
      <span className="tiptap-toolbar-sep" aria-hidden />
      {btn(editor.isActive('bulletList'),  () => editor.chain().focus().toggleBulletList().run(),  '• List',  'Bulleted list')}
      {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), '1. List', 'Numbered list')}
      <span className="tiptap-toolbar-sep" aria-hidden />
      {btn(editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), 'H', 'Sub-heading')}
      {btn(editor.isActive('paragraph'),               () => editor.chain().focus().setParagraph().run(),             'P', 'Paragraph')}
    </div>
  );
}
