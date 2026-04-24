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
      audit_logs: {
        Row: {
          action: string
          actor_profile_id: string | null
          after_json: Json | null
          before_json: Json | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          after_json?: Json | null
          before_json?: Json | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          after_json?: Json | null
          before_json?: Json | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_pages: {
        Row: {
          collaborator_id: string
          created_at: string
          id: string
          page_id: string
        }
        Insert: {
          collaborator_id: string
          created_at?: string
          id?: string
          page_id: string
        }
        Update: {
          collaborator_id?: string
          created_at?: string
          id?: string
          page_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_pages_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collaborator_pages_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborators: {
        Row: {
          ativo: boolean
          created_at: string
          email: string | null
          id: string
          nome: string
          profile_id: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          email?: string | null
          id?: string
          nome: string
          profile_id?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          email?: string | null
          id?: string
          nome?: string
          profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collaborators_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      csv_import_errors: {
        Row: {
          created_at: string
          error_message: string
          field_name: string | null
          id: string
          import_id: string
          raw_payload: Json | null
          row_number: number
        }
        Insert: {
          created_at?: string
          error_message: string
          field_name?: string | null
          id?: string
          import_id: string
          raw_payload?: Json | null
          row_number: number
        }
        Update: {
          created_at?: string
          error_message?: string
          field_name?: string | null
          id?: string
          import_id?: string
          raw_payload?: Json | null
          row_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "csv_import_errors_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "csv_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      csv_imports: {
        Row: {
          created_at: string
          detected_pages_count: number
          duplicated_rows: number
          error_message: string | null
          file_hash: string | null
          file_name: string
          file_path: string | null
          id: string
          inserted_rows: number
          invalid_rows: number
          period_end: string | null
          period_start: string | null
          status: Database["public"]["Enums"]["csv_import_status"]
          total_rows: number
          updated_rows: number
          uploaded_by: string | null
          valid_rows: number
        }
        Insert: {
          created_at?: string
          detected_pages_count?: number
          duplicated_rows?: number
          error_message?: string | null
          file_hash?: string | null
          file_name: string
          file_path?: string | null
          id?: string
          inserted_rows?: number
          invalid_rows?: number
          period_end?: string | null
          period_start?: string | null
          status?: Database["public"]["Enums"]["csv_import_status"]
          total_rows?: number
          updated_rows?: number
          uploaded_by?: string | null
          valid_rows?: number
        }
        Update: {
          created_at?: string
          detected_pages_count?: number
          duplicated_rows?: number
          error_message?: string | null
          file_hash?: string | null
          file_name?: string
          file_path?: string | null
          id?: string
          inserted_rows?: number
          invalid_rows?: number
          period_end?: string | null
          period_start?: string | null
          status?: Database["public"]["Enums"]["csv_import_status"]
          total_rows?: number
          updated_rows?: number
          uploaded_by?: string | null
          valid_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "csv_imports_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_closing_items: {
        Row: {
          adjustments: number
          amount_due: number
          closing_id: string
          collaborator_id: string
          collaborator_pct: number
          created_at: string
          final_amount: number
          gross_revenue: number
          id: string
          paid_at: string | null
          payment_note: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          adjustments?: number
          amount_due?: number
          closing_id: string
          collaborator_id: string
          collaborator_pct?: number
          created_at?: string
          final_amount?: number
          gross_revenue?: number
          id?: string
          paid_at?: string | null
          payment_note?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          adjustments?: number
          amount_due?: number
          closing_id?: string
          collaborator_id?: string
          collaborator_pct?: number
          created_at?: string
          final_amount?: number
          gross_revenue?: number
          id?: string
          paid_at?: string | null
          payment_note?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_closing_items_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "monthly_closings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_closing_items_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_closings: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          month_ref: string
          page_id: string
          status: Database["public"]["Enums"]["closing_status"]
          total_gross: number | null
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          month_ref: string
          page_id: string
          status?: Database["public"]["Enums"]["closing_status"]
          total_gross?: number | null
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          month_ref?: string
          page_id?: string
          status?: Database["public"]["Enums"]["closing_status"]
          total_gross?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_closings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_closings_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          ativo: boolean
          created_at: string
          external_page_id: string
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          external_page_id: string
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          external_page_id?: string
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      payout_receipts: {
        Row: {
          closing_item_id: string
          created_at: string
          created_by: string | null
          file_path: string | null
          generated_pdf_path: string | null
          id: string
        }
        Insert: {
          closing_item_id: string
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          generated_pdf_path?: string | null
          id?: string
        }
        Update: {
          closing_item_id?: string
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          generated_pdf_path?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_receipts_closing_item_id_fkey"
            columns: ["closing_item_id"]
            isOneToOne: false
            referencedRelation: "monthly_closing_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_receipts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_authors: {
        Row: {
          collaborator_id: string
          confidence: number | null
          created_at: string
          id: string
          post_id: string
          source: Database["public"]["Enums"]["post_author_source"]
        }
        Insert: {
          collaborator_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          post_id: string
          source?: Database["public"]["Enums"]["post_author_source"]
        }
        Update: {
          collaborator_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          post_id?: string
          source?: Database["public"]["Enums"]["post_author_source"]
        }
        Relationships: [
          {
            foreignKeyName: "post_authors_collaborator_id_fkey"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_authors_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          clicks_other: number | null
          clicks_total: number | null
          comments: number | null
          created_at: string
          description: string | null
          estimated_usd: number | null
          external_post_id: string
          id: string
          language: string | null
          link_clicks: number | null
          monetization_approx: number | null
          page_id: string
          permalink: string | null
          post_type: string | null
          published_at: string | null
          reach: number | null
          reactions: number | null
          shares: number | null
          source_import_id: string | null
          title: string | null
          updated_at: string
          views: number | null
        }
        Insert: {
          clicks_other?: number | null
          clicks_total?: number | null
          comments?: number | null
          created_at?: string
          description?: string | null
          estimated_usd?: number | null
          external_post_id: string
          id?: string
          language?: string | null
          link_clicks?: number | null
          monetization_approx?: number | null
          page_id: string
          permalink?: string | null
          post_type?: string | null
          published_at?: string | null
          reach?: number | null
          reactions?: number | null
          shares?: number | null
          source_import_id?: string | null
          title?: string | null
          updated_at?: string
          views?: number | null
        }
        Update: {
          clicks_other?: number | null
          clicks_total?: number | null
          comments?: number | null
          created_at?: string
          description?: string | null
          estimated_usd?: number | null
          external_post_id?: string
          id?: string
          language?: string | null
          link_clicks?: number | null
          monetization_approx?: number | null
          page_id?: string
          permalink?: string | null
          post_type?: string | null
          published_at?: string | null
          reach?: number | null
          reactions?: number | null
          shares?: number | null
          source_import_id?: string | null
          title?: string | null
          updated_at?: string
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "csv_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          nome: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
          nome: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          nome?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      split_rules: {
        Row: {
          active: boolean
          collaborator_pct: number
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          page_id: string
          page_pct: number
          team_pct: number
        }
        Insert: {
          active?: boolean
          collaborator_pct: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          page_id: string
          page_pct: number
          team_pct: number
        }
        Update: {
          active?: boolean
          collaborator_pct?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          page_id?: string
          page_pct?: number
          team_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "split_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "split_rules_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "colaborador"
      closing_status: "aberto" | "fechado"
      csv_import_status: "processando" | "concluido" | "falha" | "parcial"
      payment_status: "a_pagar" | "pago_fora" | "ajustado"
      post_author_source: "manual" | "hashtag"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "colaborador"],
      closing_status: ["aberto", "fechado"],
      csv_import_status: ["processando", "concluido", "falha", "parcial"],
      payment_status: ["a_pagar", "pago_fora", "ajustado"],
      post_author_source: ["manual", "hashtag"],
    },
  },
} as const
