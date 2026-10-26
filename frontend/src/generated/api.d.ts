export interface paths {
    "/api/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["health_api_v1_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Novels */
        get: operations["list_novels_api_v1_novels_get"];
        put?: never;
        /** Create Novel */
        post: operations["create_novel_api_v1_novels_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/demo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Seed Demo */
        post: operations["seed_demo_api_v1_demo_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Novel */
        get: operations["get_novel_api_v1_novels__novel_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Edit Novel */
        patch: operations["edit_novel_api_v1_novels__novel_id__patch"];
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/chapters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Chapters */
        get: operations["chapters_api_v1_novels__novel_id__chapters_get"];
        put?: never;
        /** Create Chapter */
        post: operations["create_chapter_api_v1_novels__novel_id__chapters_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/chapters/{chapter_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Chapter */
        get: operations["get_chapter_api_v1_novels__novel_id__chapters__chapter_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Edit Chapter */
        patch: operations["edit_chapter_api_v1_novels__novel_id__chapters__chapter_id__patch"];
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/chapters/{chapter_id}/references": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get References */
        get: operations["get_references_api_v1_novels__novel_id__chapters__chapter_id__references_get"];
        /** Save References */
        put: operations["save_references_api_v1_novels__novel_id__chapters__chapter_id__references_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/chapters/{chapter_id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Versions */
        get: operations["list_versions_api_v1_novels__novel_id__chapters__chapter_id__versions_get"];
        put?: never;
        /** Save Version */
        post: operations["save_version_api_v1_novels__novel_id__chapters__chapter_id__versions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/chapters/{chapter_id}/versions/{version_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Version */
        get: operations["get_version_api_v1_novels__novel_id__chapters__chapter_id__versions__version_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/chapters/{chapter_id}/canon": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm */
        post: operations["confirm_api_v1_novels__novel_id__chapters__chapter_id__canon_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/entities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Entities */
        get: operations["entities_api_v1_novels__novel_id__entities_get"];
        put?: never;
        /** Create Entity */
        post: operations["create_entity_api_v1_novels__novel_id__entities_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/entities/{entity_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Edit Entity */
        put: operations["edit_entity_api_v1_novels__novel_id__entities__entity_id__put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/threads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Threads */
        get: operations["threads_api_v1_novels__novel_id__threads_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/threads/{entity_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Thread Plan */
        put: operations["thread_plan_api_v1_novels__novel_id__threads__entity_id__put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/threads/{entity_id}/progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Thread Progress */
        post: operations["thread_progress_api_v1_novels__novel_id__threads__entity_id__progress_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/threads/{entity_id}/progress/{progress_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Change Thread Progress */
        patch: operations["change_thread_progress_api_v1_novels__novel_id__threads__entity_id__progress__progress_id__patch"];
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Plans */
        get: operations["plans_api_v1_novels__novel_id__plans_get"];
        put?: never;
        /** Create Plan */
        post: operations["create_plan_api_v1_novels__novel_id__plans_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/plans/{plan_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Edit Plan */
        put: operations["edit_plan_api_v1_novels__novel_id__plans__plan_id__put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/facts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Facts */
        get: operations["facts_api_v1_novels__novel_id__facts_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search */
        get: operations["search_api_v1_novels__novel_id__search_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/context": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Context Preview */
        post: operations["context_preview_api_v1_novels__novel_id__context_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create Job */
        post: operations["create_job_api_v1_novels__novel_id__jobs_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Jobs */
        get: operations["jobs_api_v1_jobs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/page": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Job History */
        get: operations["job_history_api_v1_jobs_page_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{job_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Job */
        get: operations["job_api_v1_jobs__job_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{job_id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Events */
        get: operations["events_api_v1_jobs__job_id__events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{job_id}/adopt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Adopt */
        post: operations["adopt_api_v1_jobs__job_id__adopt_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{job_id}/review-decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Review Decision */
        post: operations["review_decision_api_v1_jobs__job_id__review_decision_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{job_id}/apply-plan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Apply Plan */
        post: operations["apply_plan_api_v1_jobs__job_id__apply_plan_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{job_id}/prepare-rewrite": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Prepare Rewrite */
        post: operations["prepare_rewrite_api_v1_jobs__job_id__prepare_rewrite_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{job_id}/{action}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Control */
        post: operations["control_api_v1_jobs__job_id___action__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/providers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Providers */
        get: operations["providers_api_v1_providers_get"];
        put?: never;
        /** Create Provider */
        post: operations["create_provider_api_v1_providers_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/providers/{provider_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Edit Provider */
        put: operations["edit_provider_api_v1_providers__provider_id__put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/providers/{provider_id}/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Check Provider */
        post: operations["check_provider_api_v1_providers__provider_id__check_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Roles */
        get: operations["roles_api_v1_roles_get"];
        /** Save Roles */
        put: operations["save_roles_api_v1_roles_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/import-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Import Preview */
        post: operations["import_preview_api_v1_import_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Import Manuscript */
        post: operations["import_manuscript_api_v1_import_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/novels/{novel_id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Export */
        get: operations["export_api_v1_novels__novel_id__export_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspace/backup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Create Backup */
        get: operations["create_backup_api_v1_workspace_backup_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspace/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Restore Backup */
        post: operations["restore_backup_api_v1_workspace_restore_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspace/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Activate */
        post: operations["activate_api_v1_workspace_activate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspace/use-original": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Original Workspace */
        post: operations["original_workspace_api_v1_workspace_use_original_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Index */
        get: operations["index__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** ActivateInput */
        ActivateInput: {
            /** Restore Id */
            restore_id: string;
        };
        /** AdoptInput */
        AdoptInput: {
            /** Base Version Id */
            base_version_id: string;
        };
        /** AttemptOut */
        AttemptOut: {
            /** Id */
            id: string;
            /** Number */
            number: number;
            /** Call State */
            call_state: string;
            /** Output Text */
            output_text: string;
            /** Usage */
            usage: {
                [key: string]: unknown;
            } | null;
            /** Cost */
            cost: number | null;
            /** Error Code */
            error_code: string | null;
            /** Created At */
            created_at: string;
            /** Finished At */
            finished_at: string | null;
        };
        /** BlueprintCharacter */
        BlueprintCharacter: {
            /** Name */
            name: string;
            /** Role */
            role: string;
            /** Motivation */
            motivation: string;
            /** Arc */
            arc: string;
        };
        /** BlueprintResult */
        BlueprintResult: {
            /**
             * Kind
             * @constant
             */
            kind: "blueprint";
            /** Title */
            title: string;
            /** Logline */
            logline: string;
            /** Blurb */
            blurb: string;
            /** Reader Promise */
            reader_promise: string;
            /** Main Conflict */
            main_conflict: string;
            /** Ending */
            ending: string;
            /** Style Guide */
            style_guide: string;
            /** Characters */
            characters: components["schemas"]["BlueprintCharacter"][];
            /** World */
            world: components["schemas"]["BlueprintWorld"][];
            /** Volumes */
            volumes: components["schemas"]["VolumeBlueprint"][];
        };
        /** BlueprintWorld */
        BlueprintWorld: {
            /** Name */
            name: string;
            /** Rule */
            rule: string;
        };
        /** CanonInput */
        CanonInput: {
            /** Version Id */
            version_id: string;
            /** Operation Id */
            operation_id: string;
            /** Changes */
            changes?: components["schemas"]["MemoryProposal"][];
        };
        /** CanonOut */
        CanonOut: {
            /** Revision */
            revision: number;
            /** Confirmed Chapter Id */
            confirmed_chapter_id: string;
            /** Dirty From Order */
            dirty_from_order: number | null;
            /** Fact Count */
            fact_count: number;
        };
        /** ChapterInput */
        ChapterInput: {
            /**
             * Title
             * @default 新章节
             */
            title: string;
            /**
             * Volume
             * @default 第一卷
             */
            volume: string;
            /**
             * Goal
             * @default
             */
            goal: string;
        };
        /** ChapterOut */
        ChapterOut: {
            /** Id */
            id: string;
            /** Novel Id */
            novel_id: string;
            /** Title */
            title: string;
            /** Volume */
            volume: string;
            /** Position */
            position: number;
            /** Goal */
            goal: string;
            /** Working Version Id */
            working_version_id: string;
            /** Accepted Version Id */
            accepted_version_id: string | null;
            /** Review State */
            review_state: string;
            /** Char Count */
            char_count: number;
            /** Updated At */
            updated_at: string;
            version: components["schemas"]["VersionOut"];
            references: components["schemas"]["ReferenceSelection"];
            /** References Revision */
            references_revision: number;
        };
        /** ChapterOutline */
        ChapterOutline: {
            /** Number */
            number: number;
            /** Title */
            title: string;
            /** Goal */
            goal: string;
            /** Conflict */
            conflict: string;
            /** Beats */
            beats: string[];
            /** Ending Hook */
            ending_hook: string;
        };
        /** ChapterPatch */
        ChapterPatch: {
            /** Title */
            title?: string | null;
            /** Volume */
            volume?: string | null;
            /** Goal */
            goal?: string | null;
        };
        /** ChapterReferenceVersion */
        ChapterReferenceVersion: {
            /** Chapter Id */
            chapter_id: string;
            /** Version Id */
            version_id: string;
        };
        /** ChapterSummary */
        ChapterSummary: {
            /** Id */
            id: string;
            /** Novel Id */
            novel_id: string;
            /** Title */
            title: string;
            /** Volume */
            volume: string;
            /** Position */
            position: number;
            /** Goal */
            goal: string;
            /** Working Version Id */
            working_version_id: string;
            /** Accepted Version Id */
            accepted_version_id: string | null;
            /** Review State */
            review_state: string;
            /** Char Count */
            char_count: number;
            /** Updated At */
            updated_at: string;
        };
        /** ConnectionOut */
        ConnectionOut: {
            /** Reachable */
            reachable: boolean;
            /** Model Listed */
            model_listed: boolean;
            /** Message */
            message: string;
            /** Models */
            models?: string[];
            /**
             * Models Truncated
             * @default false
             */
            models_truncated: boolean;
        };
        /** ContextInput */
        ContextInput: {
            /** Chapter Id */
            chapter_id: string;
            /** Base Version Id */
            base_version_id: string;
            /** References Revision */
            references_revision?: number | null;
            /**
             * Task
             * @enum {string}
             */
            task: "continue" | "rewrite" | "plan" | "extract" | "review" | "handoff" | "blueprint" | "outline" | "inspiration";
            /**
             * Instruction
             * @default
             */
            instruction: string;
            /**
             * Provider Id
             * @default demo
             */
            provider_id: string;
            /** Excluded Source Ids */
            excluded_source_ids?: string[];
            selection?: components["schemas"]["Selection"] | null;
            /**
             * Target Chars
             * @default 500
             */
            target_chars: number;
            /** Volume Plan Id */
            volume_plan_id?: string | null;
            /**
             * Chapter Batch
             * @default 5
             */
            chapter_batch: number;
            inspiration?: components["schemas"]["InspirationReference"] | null;
            review_reference?: components["schemas"]["ReviewReference"] | null;
        };
        /** ContextOut */
        ContextOut: {
            /** Thread Guidance */
            thread_guidance?: components["schemas"]["ThreadGuidance"][];
            /** Novel Id */
            novel_id: string;
            /** Chapter Id */
            chapter_id: string;
            /** Base Version Id */
            base_version_id: string;
            /** Task */
            task: string;
            /** Canon Revision */
            canon_revision: number;
            /** Settings Revision */
            settings_revision: number;
            /**
             * References Revision
             * @default 0
             */
            references_revision: number;
            /** Pinned Entity Ids */
            pinned_entity_ids?: string[];
            /** Pinned Chapters */
            pinned_chapters?: components["schemas"]["ChapterReferenceVersion"][];
            /**
             * Reference Notes
             * @default
             */
            reference_notes: string;
            /** Target Chars */
            target_chars?: number | null;
            /** Author Brief */
            author_brief?: {
                [key: string]: string;
            };
            /**
             * Chapter Goal
             * @default
             */
            chapter_goal: string;
            /**
             * Instruction
             * @default
             */
            instruction: string;
            current_selection?: components["schemas"]["Selection"] | null;
            /** Rewrite Surroundings */
            rewrite_surroundings?: {
                [key: string]: string;
            };
            /** Sources */
            sources: components["schemas"]["Source"][];
            /** Entities */
            entities: components["schemas"]["EntityOut"][];
            /** Facts */
            facts: components["schemas"]["FactOut"][];
            /** Plans */
            plans: components["schemas"]["PlanOut"][];
            /** Estimated Input Tokens */
            estimated_input_tokens: number;
            /** Max Output Tokens */
            max_output_tokens: number;
            /** Context Window */
            context_window: number;
            /** Estimate Note */
            estimate_note: string;
            /** Notices */
            notices: string[];
            /** Excluded Source Ids */
            excluded_source_ids: string[];
            /** Source Fingerprint */
            source_fingerprint: string;
            /** Estimated Max Cost */
            estimated_max_cost: number | null;
            /** Currency */
            currency: string;
            /** Provider Name */
            provider_name: string;
            /** Model */
            model: string;
            /** Is Demo */
            is_demo: boolean;
            /**
             * Provider Url
             * @default
             */
            provider_url: string;
            /** Inspiration Title */
            inspiration_title?: string | null;
            inspiration_reference?: components["schemas"]["InspirationReference"] | null;
            review_reference?: components["schemas"]["ReviewReference"] | null;
            /** Review Explanation */
            review_explanation?: string | null;
            /** Review Suggestion */
            review_suggestion?: string | null;
        };
        /** EntityInput */
        EntityInput: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "character" | "world" | "thread" | "timeline";
            /** Name */
            name: string;
            /**
             * Summary
             * @default
             */
            summary: string;
            /**
             * Body
             * @default
             */
            body: string;
            /** Aliases */
            aliases?: string[];
            /**
             * Status
             * @default author
             * @enum {string}
             */
            status: "author" | "proposed";
        };
        /** EntityOut */
        EntityOut: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "character" | "world" | "thread" | "timeline";
            /** Name */
            name: string;
            /**
             * Summary
             * @default
             */
            summary: string;
            /**
             * Body
             * @default
             */
            body: string;
            /** Aliases */
            aliases?: string[];
            /**
             * Status
             * @default author
             * @enum {string}
             */
            status: "author" | "proposed";
            /** Id */
            id: string;
            /** Novel Id */
            novel_id: string;
            /** Updated At */
            updated_at: string;
        };
        /** Evidence */
        Evidence: {
            /** Source Id */
            source_id: string;
            /** Quote */
            quote: string;
            /** Novel Id */
            novel_id?: string | null;
            /** Chapter Id */
            chapter_id?: string | null;
            /** Chapter Title */
            chapter_title?: string | null;
            /** Chapter Position */
            chapter_position?: number | null;
            /** Version Id */
            version_id?: string | null;
            /** Paragraph Id */
            paragraph_id?: string | null;
            /** Content Hash */
            content_hash?: string | null;
            /** Kind */
            kind?: string | null;
            /** Start Codepoint */
            start_codepoint?: number | null;
            /** End Codepoint */
            end_codepoint?: number | null;
        };
        /** ExtractResult */
        ExtractResult: {
            /**
             * Kind
             * @constant
             */
            kind: "extract";
            /** Changes */
            changes: components["schemas"]["MemoryProposal"][];
            /** Uncertainties */
            uncertainties?: string[];
        };
        /** FactOut */
        FactOut: {
            /**
             * Kind
             * @default event
             * @enum {string}
             */
            kind: "event" | "state" | "knowledge" | "thread";
            /**
             * Subject
             * @default
             */
            subject: string;
            /** Claim */
            claim: string;
            /** Evidence */
            evidence: components["schemas"]["Evidence"][];
            /** Story Time */
            story_time?: string | null;
            /** Known By */
            known_by?: string[];
            /** Id */
            id: string;
            /** Novel Id */
            novel_id: string;
            /** Chapter Id */
            chapter_id: string;
            /** Version Id */
            version_id: string;
            /** Canon Revision */
            canon_revision: number;
            /** Active */
            active: boolean;
        };
        /** Finding */
        Finding: {
            /**
             * Type
             * @enum {string}
             */
            type: "fact_conflict" | "knowledge_leak" | "timeline_question" | "motivation_question" | "repetition" | "pacing" | "thread_question" | "needs_verification";
            /**
             * Severity
             * @enum {string}
             */
            severity: "important" | "question" | "suggestion";
            target: components["schemas"]["Evidence"];
            /** Source Evidence */
            source_evidence?: components["schemas"]["Evidence"][];
            /** Explanation */
            explanation: string;
            /** Suggestion */
            suggestion: string;
            /**
             * Decision
             * @default pending
             * @enum {string}
             */
            decision: "pending" | "confirmed" | "intentional" | "false_positive" | "later";
            /**
             * Decision Note
             * @default
             */
            decision_note: string;
        };
        /** FindingDecision */
        FindingDecision: {
            /** Index */
            index: number;
            /**
             * Decision
             * @enum {string}
             */
            decision: "pending" | "confirmed" | "intentional" | "false_positive" | "later";
            /**
             * Note
             * @default
             */
            note: string;
            /** Base Decision */
            base_decision?: ("pending" | "confirmed" | "intentional" | "false_positive" | "later") | null;
            /** Base Note */
            base_note?: string | null;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** HandoffResult */
        HandoffResult: {
            /**
             * Kind
             * @constant
             */
            kind: "handoff";
            /** Observations */
            observations: components["schemas"]["MemoryProposal"][];
            /** Open Questions */
            open_questions?: string[];
            /** Next Suggestions */
            next_suggestions?: string[];
        };
        /** HealthOut */
        HealthOut: {
            /** Status */
            status: string;
            /** Workspace Id */
            workspace_id: string;
            /** Workspace Name */
            workspace_name: string;
            /** Version */
            version: string;
            /**
             * Is Restored
             * @default false
             */
            is_restored: boolean;
        };
        /** ImportChapter */
        ImportChapter: {
            /** Title */
            title: string;
            /** Text */
            text: string;
        };
        /** ImportInput */
        ImportInput: {
            /** Title */
            title: string;
            /** Chapters */
            chapters: components["schemas"]["ImportChapter"][];
        };
        /** ImportPreviewInput */
        ImportPreviewInput: {
            /** Text */
            text: string;
        };
        /** InspirationOption */
        InspirationOption: {
            /** Title */
            title: string;
            /** Event */
            event: string;
            /** Motivation */
            motivation: string;
            /** Choice */
            choice: string;
            /** Cost */
            cost: string;
            /** Beats */
            beats: string[];
            /** Required Setup */
            required_setup?: string[];
            /** Evidence */
            evidence?: components["schemas"]["Evidence"][];
        };
        /** InspirationReference */
        InspirationReference: {
            /** Job Id */
            job_id: string;
            /** Option Index */
            option_index: number;
        };
        /** InspirationResult */
        InspirationResult: {
            /**
             * Kind
             * @constant
             */
            kind: "inspiration";
            /** Diagnosis */
            diagnosis: string;
            /** Options */
            options: components["schemas"]["InspirationOption"][];
        };
        /** JobDetail */
        JobDetail: {
            /** Id */
            id: string;
            /** Novel Id */
            novel_id: string;
            /** Chapter Id */
            chapter_id: string;
            /** Task */
            task: string;
            /** Instruction */
            instruction: string;
            /** Provider Id */
            provider_id: string;
            /** State */
            state: string;
            /** Base Version Id */
            base_version_id: string;
            /** Output Text */
            output_text: string;
            /** Result */
            result: components["schemas"]["ExtractResult"] | components["schemas"]["ReviewResult"] | components["schemas"]["PlanResult"] | components["schemas"]["HandoffResult"] | components["schemas"]["BlueprintResult"] | components["schemas"]["OutlineResult"] | components["schemas"]["InspirationResult"] | null;
            /** Candidate Status */
            candidate_status: string;
            /** Adopted Version Id */
            adopted_version_id: string | null;
            /** Attempt Count */
            attempt_count: number;
            /** Max Attempts */
            max_attempts: number;
            /** Max Cost */
            max_cost: number | null;
            /** Reserved Cost */
            reserved_cost: number | null;
            /** Cost */
            cost: number | null;
            /** Checkpoint */
            checkpoint: string;
            /** Error Code */
            error_code: string | null;
            /** Error Message */
            error_message: string | null;
            /** Is Demo */
            is_demo: boolean;
            /** Created At */
            created_at: string;
            /** Updated At */
            updated_at: string;
            context: components["schemas"]["ContextOut"];
            /** Attempts */
            attempts: components["schemas"]["AttemptOut"][];
        };
        /** JobHistoryItem */
        JobHistoryItem: {
            /** Id */
            id: string;
            /** Novel Id */
            novel_id: string;
            /** Chapter Id */
            chapter_id: string;
            /** Novel Title */
            novel_title: string;
            /** Chapter Title */
            chapter_title: string;
            /** Task */
            task: string;
            /** State */
            state: string;
            /** Instruction Preview */
            instruction_preview: string;
            /** Candidate Status */
            candidate_status: string;
            /** Attempt Count */
            attempt_count: number;
            /** Max Attempts */
            max_attempts: number;
            /** Is Demo */
            is_demo: boolean;
            /** Created At */
            created_at: string;
        };
        /** JobHistoryPage */
        JobHistoryPage: {
            /** Items */
            items: components["schemas"]["JobHistoryItem"][];
            /** Next Cursor */
            next_cursor?: string | null;
        };
        /** JobInput */
        JobInput: {
            /** Chapter Id */
            chapter_id: string;
            /** Base Version Id */
            base_version_id: string;
            /** References Revision */
            references_revision?: number | null;
            /**
             * Task
             * @enum {string}
             */
            task: "continue" | "rewrite" | "plan" | "extract" | "review" | "handoff" | "blueprint" | "outline" | "inspiration";
            /**
             * Instruction
             * @default
             */
            instruction: string;
            /**
             * Provider Id
             * @default demo
             */
            provider_id: string;
            /** Excluded Source Ids */
            excluded_source_ids?: string[];
            selection?: components["schemas"]["Selection"] | null;
            /**
             * Target Chars
             * @default 500
             */
            target_chars: number;
            /** Volume Plan Id */
            volume_plan_id?: string | null;
            /**
             * Chapter Batch
             * @default 5
             */
            chapter_batch: number;
            inspiration?: components["schemas"]["InspirationReference"] | null;
            review_reference?: components["schemas"]["ReviewReference"] | null;
            /** Idempotency Key */
            idempotency_key: string;
            /**
             * Max Attempts
             * @default 3
             */
            max_attempts: number;
            /** Max Cost */
            max_cost?: number | null;
        };
        /** JobOut */
        JobOut: {
            /** Id */
            id: string;
            /** Novel Id */
            novel_id: string;
            /** Chapter Id */
            chapter_id: string;
            /** Task */
            task: string;
            /** Instruction */
            instruction: string;
            /** Provider Id */
            provider_id: string;
            /** State */
            state: string;
            /** Base Version Id */
            base_version_id: string;
            /** Output Text */
            output_text: string;
            /** Result */
            result: components["schemas"]["ExtractResult"] | components["schemas"]["ReviewResult"] | components["schemas"]["PlanResult"] | components["schemas"]["HandoffResult"] | components["schemas"]["BlueprintResult"] | components["schemas"]["OutlineResult"] | components["schemas"]["InspirationResult"] | null;
            /** Candidate Status */
            candidate_status: string;
            /** Adopted Version Id */
            adopted_version_id: string | null;
            /** Attempt Count */
            attempt_count: number;
            /** Max Attempts */
            max_attempts: number;
            /** Max Cost */
            max_cost: number | null;
            /** Reserved Cost */
            reserved_cost: number | null;
            /** Cost */
            cost: number | null;
            /** Checkpoint */
            checkpoint: string;
            /** Error Code */
            error_code: string | null;
            /** Error Message */
            error_message: string | null;
            /** Is Demo */
            is_demo: boolean;
            /** Created At */
            created_at: string;
            /** Updated At */
            updated_at: string;
        };
        /** MemoryProposal */
        MemoryProposal: {
            /**
             * Kind
             * @default event
             * @enum {string}
             */
            kind: "event" | "state" | "knowledge" | "thread";
            /**
             * Subject
             * @default
             */
            subject: string;
            /** Claim */
            claim: string;
            /** Evidence */
            evidence: components["schemas"]["Evidence"][];
            /** Story Time */
            story_time?: string | null;
            /** Known By */
            known_by?: string[];
        };
        /** NovelInput */
        NovelInput: {
            /** Title */
            title: string;
            /**
             * Genre
             * @default
             */
            genre: string;
            /**
             * Premise
             * @default
             */
            premise: string;
            /**
             * Style
             * @default
             */
            style: string;
            /**
             * Platform
             * @default 番茄小说
             */
            platform: string;
            /**
             * Target Words
             * @default 1000000
             */
            target_words: number;
            /**
             * Chapter Words
             * @default 2000
             */
            chapter_words: number;
        };
        /** NovelOut */
        NovelOut: {
            /** Id */
            id: string;
            /** Title */
            title: string;
            /** Genre */
            genre: string;
            /** Premise */
            premise: string;
            /** Style */
            style: string;
            /** Platform */
            platform: string;
            /** Target Words */
            target_words: number;
            /** Chapter Words */
            chapter_words: number;
            /** Is Demo */
            is_demo: boolean;
            /** Archived */
            archived: boolean;
            /** Settings Revision */
            settings_revision: number;
            /** Canon Revision */
            canon_revision: number;
            /** Dirty From Order */
            dirty_from_order: number | null;
            /** Chapter Count */
            chapter_count: number;
            /** Accepted Count */
            accepted_count: number;
            /** Total Chars */
            total_chars: number;
            /** Created At */
            created_at: string;
            /** Updated At */
            updated_at: string;
        };
        /** NovelPatch */
        NovelPatch: {
            /** Title */
            title?: string | null;
            /** Genre */
            genre?: string | null;
            /** Premise */
            premise?: string | null;
            /** Style */
            style?: string | null;
            /** Archived */
            archived?: boolean | null;
            /** Platform */
            platform?: string | null;
            /** Target Words */
            target_words?: number | null;
            /** Chapter Words */
            chapter_words?: number | null;
        };
        /** OutlineResult */
        OutlineResult: {
            /**
             * Kind
             * @constant
             */
            kind: "outline";
            /** Volume Title */
            volume_title: string;
            /** Chapters */
            chapters: components["schemas"]["ChapterOutline"][];
        };
        /** ParagraphOut */
        ParagraphOut: {
            /** Paragraph Id */
            paragraph_id: string;
            /** Ordinal */
            ordinal: number;
            /** Text */
            text: string;
        };
        /** PlanInput */
        PlanInput: {
            /** Title */
            title: string;
            /**
             * Level
             * @default chapter
             * @enum {string}
             */
            level: "book" | "volume" | "chapter" | "scene";
            /**
             * Body
             * @default
             */
            body: string;
        };
        /** PlanOut */
        PlanOut: {
            /** Title */
            title: string;
            /**
             * Level
             * @default chapter
             * @enum {string}
             */
            level: "book" | "volume" | "chapter" | "scene";
            /**
             * Body
             * @default
             */
            body: string;
            /** Id */
            id: string;
            /** Novel Id */
            novel_id: string;
            /** Position */
            position: number;
            /** Updated At */
            updated_at: string;
            /** Parent Id */
            parent_id?: string | null;
            /** Structure */
            structure?: {
                [key: string]: unknown;
            };
        };
        /** PlanResult */
        PlanResult: {
            /**
             * Kind
             * @constant
             */
            kind: "plan";
            /** Title */
            title: string;
            /** Scenes */
            scenes: components["schemas"]["ScenePlan"][];
            /** Open Questions */
            open_questions?: string[];
        };
        /** ProductionApplyOut */
        ProductionApplyOut: {
            /** Novel Id */
            novel_id: string;
            /** Chapter Ids */
            chapter_ids: string[];
            /** Plan Ids */
            plan_ids: string[];
        };
        /** ProviderInput */
        ProviderInput: {
            /** Name */
            name: string;
            /** Base Url */
            base_url: string;
            /** Model */
            model: string;
            /** Api Key */
            api_key?: string | null;
            /**
             * Clear Key
             * @default false
             */
            clear_key: boolean;
            /**
             * Key Env
             * @default
             */
            key_env: string;
            /**
             * Stream
             * @default true
             */
            stream: boolean;
            /**
             * Include Usage
             * @default true
             */
            include_usage: boolean;
            /**
             * Json Mode
             * @default false
             */
            json_mode: boolean;
            /**
             * Token Parameter
             * @default max_tokens
             * @enum {string}
             */
            token_parameter: "max_tokens" | "max_completion_tokens";
            /**
             * Context Window
             * @default 16000
             */
            context_window: number;
            /**
             * Max Output Tokens
             * @default 2000
             */
            max_output_tokens: number;
            /** Input Price */
            input_price?: number | null;
            /** Output Price */
            output_price?: number | null;
            /**
             * Currency
             * @default CNY
             * @enum {string}
             */
            currency: "CNY" | "USD";
            /** Price Date */
            price_date?: string | null;
        };
        /** ProviderOut */
        ProviderOut: {
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Kind */
            kind: string;
            /** Base Url */
            base_url: string;
            /** Model */
            model: string;
            /** Revision */
            revision: number;
            /** Stream */
            stream: boolean;
            /** Include Usage */
            include_usage: boolean;
            /** Json Mode */
            json_mode: boolean;
            /** Token Parameter */
            token_parameter: string;
            /** Context Window */
            context_window: number;
            /** Max Output Tokens */
            max_output_tokens: number;
            /** Input Price */
            input_price: number | null;
            /** Output Price */
            output_price: number | null;
            /** Currency */
            currency: string;
            /** Price Date */
            price_date: string | null;
            /** Key Env */
            key_env: string;
            /** Has Key */
            has_key: boolean;
            /** Secret Persistent */
            secret_persistent: boolean;
        };
        /** ReferenceSelection */
        ReferenceSelection: {
            /** Entity Ids */
            entity_ids?: string[];
            /** Chapters */
            chapters?: components["schemas"]["ChapterReferenceVersion"][];
            /**
             * Notes
             * @default
             */
            notes: string;
        };
        /** ReferenceState */
        ReferenceState: {
            /** Chapter Id */
            chapter_id: string;
            /** Revision */
            revision: number;
            selection: components["schemas"]["ReferenceSelection"];
        };
        /** ReferenceUpdate */
        ReferenceUpdate: {
            /** Base Revision */
            base_revision: number;
            selection: components["schemas"]["ReferenceSelection"];
        };
        /** RestoreOut */
        RestoreOut: {
            /** Restore Id */
            restore_id: string;
            /** Novel Count */
            novel_count: number;
            /** Chapter Count */
            chapter_count: number;
            /** Message */
            message: string;
        };
        /** ReviewReference */
        ReviewReference: {
            /** Job Id */
            job_id: string;
            /** Finding Index */
            finding_index: number;
            /** Finding Hash */
            finding_hash: string;
        };
        /** ReviewResult */
        ReviewResult: {
            /**
             * Kind
             * @constant
             */
            kind: "review";
            /** Findings */
            findings: components["schemas"]["Finding"][];
            /** Summary */
            summary: string;
        };
        /** ReviewRewriteInput */
        ReviewRewriteInput: {
            /** Base Version Id */
            base_version_id: string;
            /** Index */
            index: number;
        };
        /** ReviewRewritePreparation */
        ReviewRewritePreparation: {
            /** Base Version Id */
            base_version_id: string;
            reference: components["schemas"]["ReviewReference"];
            selection: components["schemas"]["Selection"];
            finding: components["schemas"]["Finding"];
            /** Suggested Target Chars */
            suggested_target_chars: number;
        };
        /** RoleConfig */
        RoleConfig: {
            /**
             * Writer
             * @default demo
             */
            writer: string;
            /**
             * Planner
             * @default demo
             */
            planner: string;
            /**
             * Extractor
             * @default demo
             */
            extractor: string;
            /**
             * Reviewer
             * @default demo
             */
            reviewer: string;
        };
        /** SaveInput */
        SaveInput: {
            /** Base Version Id */
            base_version_id: string;
            /** Operation Id */
            operation_id: string;
            /** Text */
            text: string;
            /** Editor Doc */
            editor_doc?: {
                [key: string]: unknown;
            } | null;
        };
        /** ScenePlan */
        ScenePlan: {
            /** Goal */
            goal: string;
            /** Obstacle */
            obstacle: string;
            /** Decision */
            decision: string;
            /** Change */
            change: string;
        };
        /** SearchResult */
        SearchResult: {
            source: components["schemas"]["Source"];
            /** Match Kind */
            match_kind: string;
        };
        /** Selection */
        Selection: {
            /** Start Codepoint */
            start_codepoint: number;
            /** End Codepoint */
            end_codepoint: number;
            /** Text */
            text: string;
        };
        /** Source */
        Source: {
            /** Source Id */
            source_id: string;
            /** Novel Id */
            novel_id: string;
            /** Chapter Id */
            chapter_id: string;
            /** Chapter Title */
            chapter_title: string;
            /** Chapter Position */
            chapter_position: number;
            /** Version Id */
            version_id: string;
            /** Paragraph Id */
            paragraph_id: string;
            /** Content Hash */
            content_hash: string;
            /** Text */
            text: string;
            /** Kind */
            kind: string;
            /**
             * Pinned
             * @default false
             */
            pinned: boolean;
        };
        /** ThreadGuidance */
        ThreadGuidance: {
            /** Entity Id */
            entity_id: string;
            /** Name */
            name: string;
            /**
             * Status
             * @enum {string}
             */
            status: "planned" | "planted" | "advanced" | "resolved" | "needs_review";
            /** Author Plan */
            author_plan: string;
            /** Target Chapter Title */
            target_chapter_title: string | null;
            /** Due */
            due: boolean;
            /** Progress */
            progress: components["schemas"]["ThreadProgressOut"][];
            /** Omitted Records */
            omitted_records: number;
        };
        /** ThreadOut */
        ThreadOut: {
            entity: components["schemas"]["EntityOut"];
            /** Revision */
            revision: number;
            /** Target Chapter Id */
            target_chapter_id: string | null;
            /** Target Chapter Title */
            target_chapter_title: string | null;
            /** Target Position */
            target_position: number | null;
            /** Intent */
            intent: string;
            /** Paused */
            paused: boolean;
            /**
             * Status
             * @enum {string}
             */
            status: "planned" | "planted" | "advanced" | "resolved" | "needs_review";
            /** Progress */
            progress: components["schemas"]["ThreadProgressOut"][];
        };
        /** ThreadPlanInput */
        ThreadPlanInput: {
            /** Base Revision */
            base_revision: number;
            /** Target Chapter Id */
            target_chapter_id?: string | null;
            /**
             * Intent
             * @default
             */
            intent: string;
            /**
             * Paused
             * @default false
             */
            paused: boolean;
        };
        /** ThreadProgressChange */
        ThreadProgressChange: {
            /** Base Revision */
            base_revision: number;
            /** Voided */
            voided: boolean;
        };
        /** ThreadProgressInput */
        ThreadProgressInput: {
            /** Base Revision */
            base_revision: number;
            /** Operation Id */
            operation_id: string;
            /** Chapter Id */
            chapter_id: string;
            /** Version Id */
            version_id: string;
            /**
             * Stage
             * @enum {string}
             */
            stage: "planted" | "advanced" | "resolved";
            evidence: components["schemas"]["Evidence"];
            /**
             * Note
             * @default
             */
            note: string;
        };
        /** ThreadProgressOut */
        ThreadProgressOut: {
            /** Id */
            id: string;
            /** Chapter Id */
            chapter_id: string;
            /** Version Id */
            version_id: string;
            /** Chapter Title */
            chapter_title: string;
            /** Chapter Position */
            chapter_position: number;
            /** Paragraph Ordinal */
            paragraph_ordinal: number;
            /**
             * Stage
             * @enum {string}
             */
            stage: "planted" | "advanced" | "resolved";
            evidence: components["schemas"]["Evidence"];
            /** Note */
            note: string;
            /** Voided */
            voided: boolean;
            /** Valid */
            valid: boolean;
            /** Invalid Reason */
            invalid_reason: string;
            /** Created At */
            created_at: string;
        };
        /** ValidationError */
        ValidationError: {
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
            /** Input */
            input?: unknown;
            /** Context */
            ctx?: Record<string, never>;
        };
        /** VersionOut */
        VersionOut: {
            /** Id */
            id: string;
            /** Chapter Id */
            chapter_id: string;
            /** Parent Id */
            parent_id: string | null;
            /** Text */
            text: string;
            /** Editor Doc */
            editor_doc: {
                [key: string]: unknown;
            };
            /** Paragraphs */
            paragraphs: components["schemas"]["ParagraphOut"][];
            /** Content Hash */
            content_hash: string;
            /** Char Count */
            char_count: number;
            /** Created At */
            created_at: string;
        };
        /** VersionSummary */
        VersionSummary: {
            /** Id */
            id: string;
            /** Parent Id */
            parent_id: string | null;
            /** Char Count */
            char_count: number;
            /** Content Hash */
            content_hash: string;
            /** Created At */
            created_at: string;
        };
        /** VolumeBlueprint */
        VolumeBlueprint: {
            /** Title */
            title: string;
            /** Summary */
            summary: string;
            /** Climax */
            climax: string;
            /** Ending Hook */
            ending_hook: string;
            /** Planned Chapters */
            planned_chapters: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    health_api_v1_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthOut"];
                };
            };
        };
    };
    list_novels_api_v1_novels_get: {
        parameters: {
            query?: {
                archived?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NovelOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_novel_api_v1_novels_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NovelInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NovelOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    seed_demo_api_v1_demo_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NovelOut"];
                };
            };
        };
    };
    get_novel_api_v1_novels__novel_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NovelOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    edit_novel_api_v1_novels__novel_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NovelPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NovelOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    chapters_api_v1_novels__novel_id__chapters_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChapterSummary"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_chapter_api_v1_novels__novel_id__chapters_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChapterInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChapterOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_chapter_api_v1_novels__novel_id__chapters__chapter_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
                chapter_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChapterOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    edit_chapter_api_v1_novels__novel_id__chapters__chapter_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
                chapter_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChapterPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChapterOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_references_api_v1_novels__novel_id__chapters__chapter_id__references_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
                chapter_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReferenceState"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    save_references_api_v1_novels__novel_id__chapters__chapter_id__references_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
                chapter_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReferenceUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReferenceState"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_versions_api_v1_novels__novel_id__chapters__chapter_id__versions_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
                chapter_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VersionSummary"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    save_version_api_v1_novels__novel_id__chapters__chapter_id__versions_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
                chapter_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VersionOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_version_api_v1_novels__novel_id__chapters__chapter_id__versions__version_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
                chapter_id: string;
                version_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VersionOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    confirm_api_v1_novels__novel_id__chapters__chapter_id__canon_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
                chapter_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CanonInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CanonOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    entities_api_v1_novels__novel_id__entities_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EntityOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_entity_api_v1_novels__novel_id__entities_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EntityInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EntityOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    edit_entity_api_v1_novels__novel_id__entities__entity_id__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
                entity_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EntityInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EntityOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    threads_api_v1_novels__novel_id__threads_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThreadOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    thread_plan_api_v1_novels__novel_id__threads__entity_id__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
                entity_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ThreadPlanInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThreadOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    thread_progress_api_v1_novels__novel_id__threads__entity_id__progress_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
                entity_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ThreadProgressInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThreadOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    change_thread_progress_api_v1_novels__novel_id__threads__entity_id__progress__progress_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
                entity_id: string;
                progress_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ThreadProgressChange"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ThreadOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    plans_api_v1_novels__novel_id__plans_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_plan_api_v1_novels__novel_id__plans_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlanInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    edit_plan_api_v1_novels__novel_id__plans__plan_id__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
                plan_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlanInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    facts_api_v1_novels__novel_id__facts_get: {
        parameters: {
            query?: {
                include_inactive?: boolean;
            };
            header?: never;
            path: {
                novel_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FactOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_api_v1_novels__novel_id__search_get: {
        parameters: {
            query: {
                q: string;
            };
            header?: never;
            path: {
                novel_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SearchResult"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    context_preview_api_v1_novels__novel_id__context_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContextInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContextOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_job_api_v1_novels__novel_id__jobs_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                novel_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["JobInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    jobs_api_v1_jobs_get: {
        parameters: {
            query?: {
                novel_id?: string | null;
                chapter_id?: string | null;
                task?: ("continue" | "rewrite" | "plan" | "extract" | "review" | "handoff" | "blueprint" | "outline" | "inspiration") | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    job_history_api_v1_jobs_page_get: {
        parameters: {
            query?: {
                novel_id?: string | null;
                chapter_id?: string | null;
                task?: ("continue" | "rewrite" | "plan" | "extract" | "review" | "handoff" | "blueprint" | "outline" | "inspiration") | null;
                state?: ("queued" | "running" | "pausing" | "paused" | "cancelling" | "succeeded" | "failed" | "cancelled" | "interrupted_uncertain") | null;
                query?: string;
                cursor?: string | null;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobHistoryPage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    job_api_v1_jobs__job_id__get: {
        parameters: {
            query: {
                novel_id: string;
            };
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    events_api_v1_jobs__job_id__events_get: {
        parameters: {
            query: {
                novel_id: string;
                after?: number;
            };
            header?: {
                "last-event-id"?: string | null;
            };
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    adopt_api_v1_jobs__job_id__adopt_post: {
        parameters: {
            query: {
                novel_id: string;
            };
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdoptInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VersionOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    review_decision_api_v1_jobs__job_id__review_decision_post: {
        parameters: {
            query: {
                novel_id: string;
            };
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FindingDecision"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    apply_plan_api_v1_jobs__job_id__apply_plan_post: {
        parameters: {
            query: {
                novel_id: string;
            };
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductionApplyOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    prepare_rewrite_api_v1_jobs__job_id__prepare_rewrite_post: {
        parameters: {
            query: {
                novel_id: string;
            };
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReviewRewriteInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReviewRewritePreparation"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    control_api_v1_jobs__job_id___action__post: {
        parameters: {
            query: {
                novel_id: string;
            };
            header?: never;
            path: {
                job_id: string;
                action: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    providers_api_v1_providers_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderOut"][];
                };
            };
        };
    };
    create_provider_api_v1_providers_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProviderInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    edit_provider_api_v1_providers__provider_id__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                provider_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProviderInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    check_provider_api_v1_providers__provider_id__check_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                provider_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectionOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    roles_api_v1_roles_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoleConfig"];
                };
            };
        };
    };
    save_roles_api_v1_roles_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RoleConfig"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RoleConfig"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    import_preview_api_v1_import_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportPreviewInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportChapter"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    import_manuscript_api_v1_import_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NovelOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    export_api_v1_novels__novel_id__export_get: {
        parameters: {
            query?: {
                format?: string;
                confirmed?: boolean;
            };
            header?: never;
            path: {
                novel_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_backup_api_v1_workspace_backup_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    restore_backup_api_v1_workspace_restore_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RestoreOut"];
                };
            };
        };
    };
    activate_api_v1_workspace_activate_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ActivateInput"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    original_workspace_api_v1_workspace_use_original_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthOut"];
                };
            };
        };
    };
    index__get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
}
