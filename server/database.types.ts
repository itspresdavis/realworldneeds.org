export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      rwn_account_requests: {
        Row: {
          request_type: string
          requested_at: string
          user_id: string
        }
        Insert: {
          request_type?: string
          requested_at?: string
          user_id: string
        }
        Update: {
          request_type?: string
          requested_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rwn_location_history: {
        Row: {
          actor_id: string | null
          after_record: Json | null
          before_record: Json | null
          changed_at: string
          id: number
          location_id: string
          operation: string
        }
        Insert: {
          actor_id?: string | null
          after_record?: Json | null
          before_record?: Json | null
          changed_at?: string
          id?: never
          location_id: string
          operation: string
        }
        Update: {
          actor_id?: string | null
          after_record?: Json | null
          before_record?: Json | null
          changed_at?: string
          id?: never
          location_id?: string
          operation?: string
        }
        Relationships: []
      }
      rwn_locations: {
        Row: {
          country: string
          editorial_note: string
          id: string
          kind: string
          last_checked: string
          latitude: number | null
          longitude: number | null
          name: string
          published: boolean
          record: Json
          search_text: string | null
          source_url: string
          updated_at: string
        }
        Insert: {
          country?: string
          editorial_note?: string
          id: string
          kind?: string
          last_checked?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          published?: boolean
          record: Json
          search_text?: string | null
          source_url?: string
          updated_at?: string
        }
        Update: {
          country?: string
          editorial_note?: string
          id?: string
          kind?: string
          last_checked?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          published?: boolean
          record?: Json
          search_text?: string | null
          source_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      rwn_members: {
        Row: {
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      rwn_reviews: {
        Row: {
          author_id: string
          created_at: string
          id: string
          location_id: string
          note: string
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          location_id: string
          note: string
        }
        Update: {
          author_id?: string
          created_at?: string
          id?: string
          location_id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "rwn_reviews_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "rwn_coordinate_review"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rwn_reviews_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "rwn_editor_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rwn_reviews_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "rwn_locations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      rwn_coordinate_review: {
        Row: {
          address: string | null
          coordinate_review: string | null
          country: string | null
          declared_precision: string | null
          id: string | null
          kind: string | null
          last_checked: string | null
          latitude: number | null
          listing_url: string | null
          longitude: number | null
          name: string | null
          published: boolean | null
          shared_coordinate_count: number | null
          source_url: string | null
        }
        Relationships: []
      }
      rwn_editor_queue: {
        Row: {
          country: string | null
          globe_url: string | null
          id: string | null
          kind: string | null
          last_checked: string | null
          latitude: number | null
          longitude: number | null
          name: string | null
          public_listing_url: string | null
          published: boolean | null
          review_status: string | null
          source_url: string | null
          updated_at: string | null
        }
        Insert: {
          country?: string | null
          globe_url?: never
          id?: string | null
          kind?: string | null
          last_checked?: string | null
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          public_listing_url?: never
          published?: boolean | null
          review_status?: never
          source_url?: string | null
          updated_at?: string | null
        }
        Update: {
          country?: string | null
          globe_url?: never
          id?: string | null
          kind?: string | null
          last_checked?: string | null
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          public_listing_url?: never
          published?: boolean | null
          review_status?: never
          source_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    // Prepared correction RPCs; hosted application remains separately gated.
    // Queue tables remain in the unexposed rwn_private schema.
    Functions: {
      rwn_correction_status: { Args: Record<PropertyKey, never>; Returns: boolean }
      rwn_submit_correction: {
        Args: { p_resource_id: string; p_category: string; p_note: string; p_submission_id: string; p_actor: string }
        Returns: Json
      }
      rwn_correction_queue: {
        Args: { p_page?: number; p_status?: string; p_id?: string | null }
        Returns: Json
      }
      rwn_decide_correction: {
        Args: { p_id: string; p_revision: number; p_status: string; p_priority: string; p_assignment: string; p_reason: string; p_evidence_url: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
