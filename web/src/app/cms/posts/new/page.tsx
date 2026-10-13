'use client';

import { PageHeader } from '@/components/dashboard/shell';
import { PostEditor } from '@/components/cms/post-editor';

export default function NewPostPage() {
  return (
    <>
      <PageHeader title="New article" description="Save as a draft first — nothing is public until you publish." />
      <PostEditor post={null} />
    </>
  );
}
