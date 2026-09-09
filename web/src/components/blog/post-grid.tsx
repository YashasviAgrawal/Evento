import { Newspaper } from 'lucide-react';
import type { BlogPostCard as BlogPostCardType } from '@/lib/types';
import { EmptyState } from '@/components/ui/index';
import { PostCard } from './post-card';

export function PostGrid({ posts }: { posts: BlogPostCardType[] }) {
  if (posts.length === 0) {
    return (
      <EmptyState
        icon={<Newspaper className="h-8 w-8" />}
        title="Nothing here yet"
        description="There are no articles in this section right now. Check back soon."
      />
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map((post, index) => (
        // Only the first card is above the fold on any viewport, so it is the
        // one worth preloading.
        <PostCard key={post.id} post={post} priority={index === 0} />
      ))}
    </div>
  );
}
