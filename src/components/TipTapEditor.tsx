/**
 * TipTapEditor -- minimal rich-text editor used by the guidebook
 * admin editor for body_html fields. Toolbar is intentionally tight
 * (bold, italic, link, lists, paragraph) so pasted styles don't leak
 * — TipTap's StarterKit handles this for us as long as we DON'T
 * include extensions that re-introduce them.
 *
 * Output is sanitised HTML on the way out (DOMPurify-friendly).
 */

import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { supabase } from '../lib/supabase';
import { compressImageFile } from '../lib/compressImage';

/** Body-image uploads go to the same bucket the property image manager
 *  uses — its storage policies already allow authenticated uploads.
 *  Scoped under a folder so guidebook body images are easy to find. */
const UPLOAD_BUCKET = 'property-images';
const UPLOAD_FOLDER = 'guidebook-body';

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
      // Without this, StarterKit's schema DROPS <img> nodes from any
      // loaded body_html — imported Hostfully cards (TV remote photos
      // etc.) would render without their images here and lose them
      // permanently on the next save.
      Image,
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function uploadAndInsert(file: File | undefined) {
    if (!file || uploading) return;
    if (!file.type.startsWith('image/')) {
      window.alert('Please pick an image file.');
      return;
    }
    setUploading(true);
    try {
      const compressed = await compressImageFile(file);
      const ext = (compressed.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${UPLOAD_FOLDER}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, compressed, {
        cacheControl: '31536000',
        upsert: false,
        contentType: compressed.type,
      });
      if (error) throw error;
      const { data } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(path);
      if (!data?.publicUrl) throw new Error('no public URL returned');
      editor.chain().focus().setImage({ src: data.publicUrl }).run();
    } catch (err: any) {
      console.error('[TipTapEditor] image upload failed:', err);
      window.alert(`Image upload failed: ${err?.message || err}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

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
      <span className="tiptap-toolbar-sep" aria-hidden />
      {btn(false, () => fileRef.current?.click(), uploading ? '…' : '🖼', uploading ? 'Uploading…' : 'Insert image')}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => uploadAndInsert(e.target.files?.[0])}
      />
    </div>
  );
}
