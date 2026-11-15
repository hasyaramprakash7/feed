// models/Ad.js
const mongoose = require('mongoose');

const IDENTITY_TYPES = ['User', 'Vendor'];

// ─────────────────────────────────────────────────────────────
// COMMENT SCHEMA
// ─────────────────────────────────────────────────────────────
const commentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'userType',
      index: true,
    },
    userType: {
      type: String,
      required: true,
      enum: IDENTITY_TYPES,
      default: 'User',
    },
    userName: { type: String, default: '', trim: true },
    userAvatar: { type: String, default: '', trim: true },
    text: {
      type: String,
      required: [true, 'Comment text is required'],
      trim: true,
      maxlength: 1000,
    },
    likes: [
      {
        identityId: { type: mongoose.Schema.Types.ObjectId, required: true },
        identityType: {
          type: String,
          required: true,
          enum: IDENTITY_TYPES,
          default: 'User',
        },
      },
    ],
    likesCount: { type: Number, default: 0, min: 0 },
    parentId: { type: mongoose.Schema.Types.ObjectId, default: null },
    replies: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          refPath: 'userType',
        },
        userType: {
          type: String,
          enum: IDENTITY_TYPES,
          default: 'User',
        },
        userName: { type: String, default: '' },
        userAvatar: { type: String, default: '' },
        text: { type: String, trim: true, maxlength: 1000 },
        likes: [
          {
            identityId: { type: mongoose.Schema.Types.ObjectId },
            identityType: {
              type: String,
              enum: IDENTITY_TYPES,
              default: 'User',
            },
          },
        ],
        likesCount: { type: Number, default: 0, min: 0 },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    repliesCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// ─────────────────────────────────────────────────────────────
// AD SCHEMA
// ✅ NEW: `thumbnailSmall` — a ~120px thumb written at upload time
// ✅ NEW: `location.coordinates` — GeoJSON point for 2dsphere index
// ─────────────────────────────────────────────────────────────
const adSchema = new mongoose.Schema(
  {
    title: { type: String, default: '', trim: true, maxlength: 150 },
    description: { type: String, default: '', trim: true, maxlength: 2200 },
    category: { type: String, default: '', trim: true },
    tags: [{ type: String, trim: true }],

    image: { type: String, default: '', trim: true },
    video: { type: String, default: '', trim: true },
    hlsUrl: { type: String, default: '', trim: true },
    hlsStatus: {
      type: String,
      enum: ['none', 'processing', 'ready', 'failed'],
      default: 'none',
    },
    thumbnail: { type: String, default: '', trim: true },
    // ✅ NEW: small thumbnail (≈120px) for map circles
    thumbnailSmall: { type: String, default: '', trim: true },

    mediaType: {
      type: String,
      enum: ['image', 'video', 'carousel'],
      default: 'image',
    },

    carousel: [
      {
        media: { type: String, default: '' },
        mediaType: { type: String, enum: ['image', 'video'], default: 'image' },
      },
    ],

    link: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true },
    isProductAd: { type: Boolean, default: false },

    postKind: {
      type: String,
      enum: ['post', 'reel', 'story', 'igtv'],
      default: 'post',
    },

    postType: {
      type: String,
      enum: ['vendor', 'user'],
      default: 'user',
      index: true,
    },

    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
      refPath: 'postType',
      index: true,
    },

    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: false,
      index: true,
    },
    vendorName: { type: String, default: '', trim: true },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      index: true,
    },
    userName: { type: String, default: '', trim: true },
    userAvatar: { type: String, default: '', trim: true },

    location: {
      name: { type: String, default: '' },
      latitude: { type: Number },
      longitude: { type: Number },
      // ✅ NEW: GeoJSON point [lng, lat] — populated by pre-save hook
      coordinates: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: undefined },
      },
    },

    taggedUsers: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: { type: String, default: '' },
        username: { type: String, default: '' },
      },
    ],

    collaborators: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: { type: String, default: '' },
        avatar: { type: String, default: '' },
      },
    ],

    audio: {
      name: { type: String, default: '' },
      artist: { type: String, default: '' },
      url: { type: String, default: '' },
    },

    likes: [
      {
        identityId: { type: mongoose.Schema.Types.ObjectId, required: true },
        identityType: {
          type: String,
          required: true,
          enum: IDENTITY_TYPES,
          default: 'User',
        },
      },
    ],
    likesCount: { type: Number, default: 0, min: 0 },
    viewsCount: { type: Number, default: 0, min: 0 },
    sharesCount: { type: Number, default: 0, min: 0 },
    savesCount: { type: Number, default: 0, min: 0 },
    reachCount: { type: Number, default: 0, min: 0 },
    impressionsCount: { type: Number, default: 0, min: 0 },

    comments: [commentSchema],
    commentsCount: { type: Number, default: 0, min: 0 },

    savedBy: [
      {
        identityId: { type: mongoose.Schema.Types.ObjectId, required: true },
        identityType: {
          type: String,
          required: true,
          enum: IDENTITY_TYPES,
          default: 'User',
        },
      },
    ],

    isArchived: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },

    isReel: { type: Boolean, default: false },
    reelDuration: { type: Number, default: 0 },

    isStory: { type: Boolean, default: false },
    storyExpiresAt: { type: Date, default: null },

    commentsDisabled: { type: Boolean, default: false },
    hideLikeCount: { type: Boolean, default: false },

    engagementScore: { type: Number, default: 0 },
    trendingScore: { type: Number, default: 0 },
    lastEngagementAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// ✅ NEW: sync location.coordinates from lat/lng on every save
adSchema.pre('validate', function (next) {
  if (this.location) {
    const lat = this.location.latitude;
    const lng = this.location.longitude;
    if (
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      isFinite(lat) &&
      isFinite(lng)
    ) {
      this.location.coordinates = {
        type: 'Point',
        coordinates: [lng, lat],
      };
    } else {
      this.location.coordinates = undefined;
    }
  }

  if (!this.image && !this.video && !this.carousel?.length) {
    return next(new Error('A post must have either an image, video, or carousel'));
  }
  if (!this.ownerId) {
    if (this.vendorId) {
      this.ownerId = this.vendorId;
      this.postType = 'vendor';
    } else if (this.userId) {
      this.ownerId = this.userId;
      this.postType = 'user';
    } else {
      return next(new Error('A post must belong to either a vendor or a user'));
    }
  }
  if (this.postKind === 'reel') this.isReel = true;
  if (this.postKind === 'story') {
    this.isStory = true;
    if (!this.storyExpiresAt) {
      this.storyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
  }
  next();
});

adSchema.pre('save', function (next) {
  if (this.likes) this.likesCount = this.likes.length;
  if (this.comments) this.commentsCount = this.comments.length;
  if (this.savedBy) this.savesCount = this.savedBy.length;

  const totalEngagements =
    this.likesCount + this.commentsCount + this.sharesCount + this.savesCount;
  const daysSinceCreation = Math.max(
    1,
    (Date.now() - this.createdAt) / (1000 * 60 * 60 * 24)
  );
  this.engagementScore = totalEngagements / daysSinceCreation;

  const recencyFactor = Math.exp(-daysSinceCreation / 7);
  this.trendingScore =
    this.engagementScore * recencyFactor * (1 + Math.log10(this.viewsCount + 1));

  next();
});

// ─────────────────────────────────────────────────────────────
// INDEXES
// ✅ NEW: 2dsphere geospatial index for fast bbox queries
// ✅ NEW: compound index for map bounds filter
// ─────────────────────────────────────────────────────────────
adSchema.index({ title: 'text', description: 'text', category: 'text' });
adSchema.index({ isActive: 1, isDeleted: 1 });
adSchema.index({ ownerId: 1 });
adSchema.index({ ownerId: 1, postType: 1, isActive: 1, createdAt: -1 });
adSchema.index({ vendorId: 1 });
adSchema.index({ userId: 1 });
adSchema.index({ postType: 1 });
adSchema.index({ postKind: 1 });
adSchema.index({ isActive: 1, viewsCount: -1, createdAt: -1 });
adSchema.index({ isActive: 1, likesCount: -1, createdAt: -1 });
adSchema.index({ isActive: 1, trendingScore: -1, createdAt: -1 });
adSchema.index({ tags: 1 });
adSchema.index({ 'location.name': 1 });
adSchema.index({ createdAt: -1 });
adSchema.index({ engagementScore: -1 });
adSchema.index({ hlsStatus: 1, createdAt: -1 });

// ✅ NEW: geospatial — makes bbox query a fast index scan
adSchema.index({ 'location.coordinates': '2dsphere' });

// ✅ NEW: compound index tuned for the exact /map/bounds query
adSchema.index({
  isActive: 1,
  isDeleted: 1,
  mediaType: 1,
  createdAt: -1,
});

// ─────────────────────────────────────────────────────────────
// STORY SCHEMA
// ─────────────────────────────────────────────────────────────
const storySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'userType',
      index: true,
    },
    userType: {
      type: String,
      required: true,
      enum: IDENTITY_TYPES,
      default: 'User',
    },
    userName: { type: String, default: '', trim: true },
    userAvatar: { type: String, default: '', trim: true },
    media: { type: String, required: true, trim: true },
    mediaType: {
      type: String,
      enum: ['image', 'video'],
      default: 'image',
    },
    hlsUrl: { type: String, default: '', trim: true },
    caption: { type: String, default: '', trim: true, maxlength: 500 },
    viewers: [
      {
        identityId: { type: mongoose.Schema.Types.ObjectId, required: true },
        identityType: {
          type: String,
          required: true,
          enum: IDENTITY_TYPES,
          default: 'User',
        },
      },
    ],
    viewersCount: { type: Number, default: 0, min: 0 },
    reactions: [
      {
        identityId: { type: mongoose.Schema.Types.ObjectId, required: true },
        identityType: {
          type: String,
          required: true,
          enum: IDENTITY_TYPES,
          default: 'User',
        },
        emoji: { type: String, default: '❤️' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      index: true,
    },
    adId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ad', default: null },
    isHighlight: { type: Boolean, default: false },
    highlightName: { type: String, default: '', trim: true },
    highlightCover: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

storySchema.index({ userId: 1, userType: 1, expiresAt: -1 });
storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ─────────────────────────────────────────────────────────────
// Other schemas — UNCHANGED
// ─────────────────────────────────────────────────────────────
const highlightSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'userType',
      index: true,
    },
    userType: {
      type: String,
      required: true,
      enum: IDENTITY_TYPES,
      default: 'User',
    },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    coverImage: { type: String, default: '', trim: true },
    stories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Story' }],
    storiesCount: { type: Number, default: 0, min: 0 },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);
highlightSchema.index({ userId: 1, userType: 1, order: 1 });

const adMessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'senderType',
    },
    senderType: {
      type: String,
      required: true,
      enum: IDENTITY_TYPES,
      default: 'User',
    },
    senderName: { type: String, default: '' },
    senderAvatar: { type: String, default: '' },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'receiverType',
    },
    receiverType: {
      type: String,
      required: true,
      enum: IDENTITY_TYPES,
      default: 'User',
    },
    text: { type: String, default: '', trim: true, maxlength: 2000 },
    media: { type: String, default: '', trim: true },
    mediaType: {
      type: String,
      enum: ['none', 'image', 'video', 'audio', 'file'],
      default: 'none',
    },
    sharedAdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ad', default: null },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    reactions: [
      {
        identityId: { type: mongoose.Schema.Types.ObjectId, required: true },
        identityType: {
          type: String,
          required: true,
          enum: IDENTITY_TYPES,
          default: 'User',
        },
        emoji: { type: String, default: '❤️' },
      },
    ],
    replyToMessageId: { type: mongoose.Schema.Types.ObjectId, default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);
adMessageSchema.index({ conversationId: 1, createdAt: -1 });

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        identityId: {
          type: mongoose.Schema.Types.ObjectId,
          required: true,
          refPath: 'participants.identityType',
          index: true,
        },
        identityType: {
          type: String,
          required: true,
          enum: IDENTITY_TYPES,
          default: 'User',
        },
        name: { type: String, default: '' },
        avatar: { type: String, default: '' },
        phone: { type: String, default: '' },
        lastReadAt: { type: Date, default: null },
      },
    ],
    lastMessage: {
      text: { type: String, default: '' },
      senderId: { type: mongoose.Schema.Types.ObjectId },
      senderType: {
        type: String,
        enum: IDENTITY_TYPES,
        default: 'User',
      },
      senderName: { type: String, default: '' },
      createdAt: { type: Date, default: null },
      mediaType: { type: String, default: 'none' },
    },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    isGroup: { type: Boolean, default: false },
    groupName: { type: String, default: '' },
    groupAvatar: { type: String, default: '' },
    unreadCounts: [
      {
        identityId: { type: mongoose.Schema.Types.ObjectId, required: true },
        identityType: {
          type: String,
          required: true,
          enum: IDENTITY_TYPES,
          default: 'User',
        },
        count: { type: Number, default: 0, min: 0 },
      },
    ],
    isArchived: { type: Boolean, default: false },
    isMuted: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
  },
  { timestamps: true }
);
conversationSchema.index({ 'participants.identityId': 1, lastMessageAt: -1 });

const followSchema = new mongoose.Schema(
  {
    followerId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'followerType',
      index: true,
    },
    followerType: {
      type: String,
      required: true,
      enum: IDENTITY_TYPES,
      default: 'User',
    },
    followerName: { type: String, default: '' },
    followerAvatar: { type: String, default: '' },
    followingId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'followingType',
      index: true,
    },
    followingType: {
      type: String,
      required: true,
      enum: IDENTITY_TYPES,
      default: 'User',
    },
    followingName: { type: String, default: '' },
    followingAvatar: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'accepted',
    },
    isCloseFriend: { type: Boolean, default: false },
    notificationsEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);
followSchema.index(
  {
    followerId: 1,
    followerType: 1,
    followingId: 1,
    followingType: 1,
  },
  { unique: true }
);
followSchema.index({ followingId: 1, followingType: 1, status: 1 });
followSchema.index({ followerId: 1, followerType: 1, status: 1 });

const statsSchema = new mongoose.Schema(
  {
    identityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    identityType: {
      type: String,
      required: true,
      enum: IDENTITY_TYPES,
      default: 'User',
      index: true,
    },
    name: { type: String, default: '' },
    shopName: { type: String, default: '' },
    username: { type: String, default: '', trim: true, lowercase: true },
    bio: { type: String, default: '', trim: true, maxlength: 300 },
    website: { type: String, default: '', trim: true },
    avatar: { type: String, default: '', trim: true },
    logo: { type: String, default: '', trim: true },
    shopImage: { type: String, default: '', trim: true },
    profilePic: { type: String, default: '', trim: true },
    category: { type: String, default: '', trim: true },
    businessType: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true },
    address: {
      street: { type: String, default: '' },
      locality: { type: String, default: '' },
      city: { type: String, default: '' },
      district: { type: String, default: '' },
      state: { type: String, default: '' },
      pincode: { type: String, default: '' },
      country: { type: String, default: '' },
      latitude: { type: Number },
      longitude: { type: Number },
    },
    isVerified: { type: Boolean, default: false },
    isPrivate: { type: Boolean, default: false },
    isBusiness: { type: Boolean, default: false },
    isOnline: { type: Boolean, default: false },
    postsCount: { type: Number, default: 0, min: 0 },
    followersCount: { type: Number, default: 0, min: 0 },
    followingCount: { type: Number, default: 0, min: 0 },
    reelsCount: { type: Number, default: 0, min: 0 },
    storiesCount: { type: Number, default: 0, min: 0 },
    highlightsCount: { type: Number, default: 0, min: 0 },
    totalLikesCount: { type: Number, default: 0, min: 0 },
    totalViewsCount: { type: Number, default: 0, min: 0 },
    totalCommentsCount: { type: Number, default: 0, min: 0 },
    totalSharesCount: { type: Number, default: 0, min: 0 },
    engagementRate: { type: Number, default: 0, min: 0 },
    viewsLast30Days: { type: Number, default: 0, min: 0 },
    reachLast30Days: { type: Number, default: 0, min: 0 },
    profileVisitsLast30Days: { type: Number, default: 0, min: 0 },
    totalViews: { type: Number, default: 0, min: 0 },
    totalLeads: { type: Number, default: 0, min: 0 },
    totalCalls: { type: Number, default: 0, min: 0 },
    followers: [
      {
        identityId: { type: mongoose.Schema.Types.ObjectId, required: true },
        identityType: {
          type: String,
          enum: IDENTITY_TYPES,
          default: 'User',
        },
        followedAt: { type: Date, default: Date.now },
      },
    ],
    following: [
      {
        identityId: { type: mongoose.Schema.Types.ObjectId, required: true },
        identityType: {
          type: String,
          enum: IDENTITY_TYPES,
          default: 'User',
        },
        followedAt: { type: Date, default: Date.now },
      },
    ],
    highlights: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Highlight' }],
    pinnedPosts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Ad' }],
  },
  { timestamps: true }
);
statsSchema.index({ identityId: 1, identityType: 1 }, { unique: true });
statsSchema.index({ username: 1 });
statsSchema.index({ followersCount: -1 });
statsSchema.index({ followingCount: -1 });
statsSchema.index({ name: 'text', shopName: 'text', username: 'text' });

const Stats = mongoose.models.Stats || mongoose.model('Stats', statsSchema);
const UserStats = Stats;
const VendorStats = Stats;

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'userType',
      index: true,
    },
    userType: {
      type: String,
      required: true,
      enum: IDENTITY_TYPES,
      default: 'User',
    },
    type: {
      type: String,
      enum: [
        'like',
        'comment',
        'follow',
        'follow_request',
        'mention',
        'tag',
        'message',
        'story_view',
        'story_reaction',
        'share',
        'repost',
        'view',
        'lead',
        'call',
        'whatsapp',
      ],
      required: true,
    },
    actorId: { type: mongoose.Schema.Types.ObjectId },
    actorType: {
      type: String,
      enum: IDENTITY_TYPES,
      default: 'User',
    },
    actorName: { type: String, default: '' },
    actorAvatar: { type: String, default: '' },
    adId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ad', default: null },
    commentId: { type: mongoose.Schema.Types.ObjectId, default: null },
    storyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Story', default: null },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null,
    },
    messageId: { type: mongoose.Schema.Types.ObjectId, default: null },
    text: { type: String, default: '', trim: true, maxlength: 500 },
    thumbnail: { type: String, default: '', trim: true },
    isRead: { type: Boolean, default: false },
    isSeen: { type: Boolean, default: false },
  },
  { timestamps: true }
);
notificationSchema.index({ userId: 1, userType: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, userType: 1, isRead: 1 });

const activitySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'userType',
      index: true,
    },
    userType: {
      type: String,
      required: true,
      enum: IDENTITY_TYPES,
      default: 'User',
    },
    type: {
      type: String,
      enum: [
        'liked_post',
        'liked_comment',
        'commented',
        'followed',
        'story_viewed',
        'story_liked',
        'reel_watched',
        'profile_visited',
        'search',
        'share',
        'save',
        'message_sent',
        'message_received',
      ],
      required: true,
    },
    adId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ad', default: null },
    targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
    targetType: {
      type: String,
      enum: IDENTITY_TYPES,
      default: 'User',
    },
    targetName: { type: String, default: '' },
    targetAvatar: { type: String, default: '' },
    commentId: { type: mongoose.Schema.Types.ObjectId, default: null },
    storyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Story', default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    isPrivate: { type: Boolean, default: false },
  },
  { timestamps: true }
);
activitySchema.index({ userId: 1, userType: 1, createdAt: -1 });
activitySchema.index({ userId: 1, userType: 1, type: 1 });
activitySchema.index({
  userId: 1,
  userType: 1,
  type: 1,
  adId: 1,
  createdAt: -1,
});

const savedCollectionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'userType',
      index: true,
    },
    userType: {
      type: String,
      required: true,
      enum: IDENTITY_TYPES,
      default: 'User',
    },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    coverImage: { type: String, default: '', trim: true },
    posts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Ad' }],
    postsCount: { type: Number, default: 0, min: 0 },
    isDefault: { type: Boolean, default: false },
    isPrivate: { type: Boolean, default: true },
  },
  { timestamps: true }
);
savedCollectionSchema.index({ userId: 1, userType: 1, name: 1 });

const reachAnalyticsSchema = new mongoose.Schema(
  {
    adId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ad',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'userType',
      index: true,
    },
    userType: {
      type: String,
      required: true,
      enum: IDENTITY_TYPES,
      default: 'User',
    },
    date: { type: Date, required: true, index: true },
    views: { type: Number, default: 0 },
    uniqueViews: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    saves: { type: Number, default: 0 },
    profileVisits: { type: Number, default: 0 },
    followerGrowth: { type: Number, default: 0 },
    demographics: {
      ageGroups: {
        '13-17': { type: Number, default: 0 },
        '18-24': { type: Number, default: 0 },
        '25-34': { type: Number, default: 0 },
        '35-44': { type: Number, default: 0 },
        '45-54': { type: Number, default: 0 },
        '55+': { type: Number, default: 0 },
      },
      gender: {
        male: { type: Number, default: 0 },
        female: { type: Number, default: 0 },
        other: { type: Number, default: 0 },
      },
      topLocations: [
        {
          name: String,
          count: Number,
        },
      ],
    },
    trafficSources: {
      home: { type: Number, default: 0 },
      explore: { type: Number, default: 0 },
      profile: { type: Number, default: 0 },
      hashtags: { type: Number, default: 0 },
      search: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);
reachAnalyticsSchema.index({ adId: 1, date: -1 });
reachAnalyticsSchema.index({ userId: 1, userType: 1, date: -1 });

const hashtagSchema = new mongoose.Schema(
  {
    tag: { type: String, required: true, unique: true, lowercase: true, trim: true },
    postsCount: { type: Number, default: 0, min: 0 },
    reachCount: { type: Number, default: 0, min: 0 },
    trendingScore: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
hashtagSchema.index({ trendingScore: -1 });
hashtagSchema.index({ postsCount: -1 });

const userInterestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'userType',
      index: true,
    },
    userType: {
      type: String,
      required: true,
      enum: IDENTITY_TYPES,
      default: 'User',
    },
    categories: [{ name: String, score: { type: Number, default: 0 } }],
    tags: [{ name: String, score: { type: Number, default: 0 } }],
    interactedUsers: [
      {
        identityId: { type: mongoose.Schema.Types.ObjectId },
        identityType: {
          type: String,
          enum: IDENTITY_TYPES,
          default: 'User',
        },
        score: { type: Number, default: 0 },
      },
    ],
    contentTypes: {
      image: { type: Number, default: 0 },
      video: { type: Number, default: 0 },
      reel: { type: Number, default: 0 },
      carousel: { type: Number, default: 0 },
    },
    lastUpdatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
userInterestSchema.index({ userId: 1, userType: 1 }, { unique: true });

// ═════════════════════════════════════════════════════════════
// SAFE MODEL REGISTRATION
// ═════════════════════════════════════════════════════════════
const Ad = mongoose.models.Ad || mongoose.model('Ad', adSchema);
const Story = mongoose.models.Story || mongoose.model('Story', storySchema);
const Highlight =
  mongoose.models.Highlight || mongoose.model('Highlight', highlightSchema);
const Follow = mongoose.models.Follow || mongoose.model('Follow', followSchema);
const AdMessage =
  mongoose.models.AdMessage || mongoose.model('AdMessage', adMessageSchema);
const Conversation =
  mongoose.models.Conversation ||
  mongoose.model('Conversation', conversationSchema);
const Notification =
  mongoose.models.Notification ||
  mongoose.model('Notification', notificationSchema);
const Activity =
  mongoose.models.Activity || mongoose.model('Activity', activitySchema);
const SavedCollection =
  mongoose.models.SavedCollection ||
  mongoose.model('SavedCollection', savedCollectionSchema);
const ReachAnalytics =
  mongoose.models.ReachAnalytics ||
  mongoose.model('ReachAnalytics', reachAnalyticsSchema);
const Hashtag = mongoose.models.Hashtag || mongoose.model('Hashtag', hashtagSchema);
const UserInterest =
  mongoose.models.UserInterest || mongoose.model('UserInterest', userInterestSchema);

module.exports = {
  Ad,
  Story,
  Highlight,
  Follow,
  UserStats,
  VendorStats,
  Stats,
  AdMessage,
  Conversation,
  Notification,
  Activity,
  SavedCollection,
  ReachAnalytics,
  Hashtag,
  UserInterest,
  adSchema,
  storySchema,
  highlightSchema,
  followSchema,
  statsSchema,
  adMessageSchema,
  conversationSchema,
  notificationSchema,
  activitySchema,
  savedCollectionSchema,
  reachAnalyticsSchema,
  hashtagSchema,
  userInterestSchema,
  commentSchema,
  IDENTITY_TYPES,
};