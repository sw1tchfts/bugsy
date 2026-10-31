
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "app": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invitation":
{ Args: { "invite_token": string }; Returns: string
                           },
"has_permission":
{ Args: { "perm": string,"tenant": string }; Returns: boolean
                           },
"invitation_preview":
{ Args: { "invite_token": string }; Returns: {
              "email": string,"role_name": string,"tenant_name": string,"valid": boolean
            }[]
                           },
"is_member":
{ Args: { "tenant": string }; Returns: boolean
                           },
"is_platform_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"member_directory":
{ Args: { "tenant": string }; Returns: {
              "email": string,"last_sign_in_at": string,"user_id": string
            }[]
                           },
"next_number":
{ Args: { "counter_key": string,"tenant": string }; Returns: number
                           },
"phone_digits":
{ Args: { "phone": string }; Returns: string
                           },
"role_is_owner":
{ Args: { "role": string }; Returns: boolean
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "accounts": {
                  Row: {
                    "archived_at": string | null,"billing_city": string | null,"billing_line1": string | null,"billing_line2": string | null,"billing_postal_code": string | null,"billing_state_code": string | null,"created_at": string,"created_by": string | null,"email": string | null,"id": string,"lead_id": string | null,"name": string,"notes": string | null,"phone": string | null,"phone_digits": string | null,"po_required": boolean,"status": string,"tenant_id": string,"terms_days": number,"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"billing_city"?: string | null,"billing_line1"?: string | null,"billing_line2"?: string | null,"billing_postal_code"?: string | null,"billing_state_code"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"id"?: string,"lead_id"?: string | null,"name": string,"notes"?: string | null,"phone"?: string | null,"phone_digits"?: never,"po_required"?: boolean,"status"?: string,"tenant_id": string,"terms_days"?: number,"type": string,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"billing_city"?: string | null,"billing_line1"?: string | null,"billing_line2"?: string | null,"billing_postal_code"?: string | null,"billing_state_code"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"id"?: string,"lead_id"?: string | null,"name"?: string,"notes"?: string | null,"phone"?: string | null,"phone_digits"?: never,"po_required"?: boolean,"status"?: string,"tenant_id"?: string,"terms_days"?: number,"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "accounts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"after": Json | null,"before": Json | null,"created_at": string,"id": number,"row_id": string | null,"table_name": string,"tenant_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"id"?: never,"row_id"?: string | null,"table_name": string,"tenant_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"id"?: never,"row_id"?: string | null,"table_name"?: string,"tenant_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"branches": {
                  Row: {
                    "address": string,"archived_at": string | null,"business_license_number": string | null,"created_at": string,"created_by": string | null,"id": string,"license_year": number | null,"name": string,"state_code": string,"tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address": string,"archived_at"?: string | null,"business_license_number"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"license_year"?: number | null,"name": string,"state_code": string,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string,"archived_at"?: string | null,"business_license_number"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"license_year"?: number | null,"name"?: string,"state_code"?: string,"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "branches_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "account_id": string | null,"archived_at": string | null,"created_at": string,"created_by": string | null,"e_notice_consent_at": string | null,"e_notice_consent_note": string | null,"email": string | null,"id": string,"name": string,"notes": string | null,"phone": string | null,"phone_digits": string | null,"preferred_channel": string | null,"property_id": string | null,"role": string,"sms_opt_in": boolean,"tenant_id": string,"unit_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"e_notice_consent_at"?: string | null,"e_notice_consent_note"?: string | null,"email"?: string | null,"id"?: string,"name": string,"notes"?: string | null,"phone"?: string | null,"phone_digits"?: never,"preferred_channel"?: string | null,"property_id"?: string | null,"role": string,"sms_opt_in"?: boolean,"tenant_id": string,"unit_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string | null,"archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"e_notice_consent_at"?: string | null,"e_notice_consent_note"?: string | null,"email"?: string | null,"id"?: string,"name"?: string,"notes"?: string | null,"phone"?: string | null,"phone_digits"?: never,"preferred_channel"?: string | null,"property_id"?: string | null,"role"?: string,"sms_opt_in"?: boolean,"tenant_id"?: string,"unit_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_property_id_unit_id_fkey"
      columns: ["property_id","unit_id"]
isOneToOne: false
      referencedRelation: "units"
      referencedColumns: ["property_id","id"]
    },{
      foreignKeyName: "contacts_tenant_id_account_id_fkey"
      columns: ["tenant_id","account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "contacts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contacts_tenant_id_property_id_fkey"
      columns: ["tenant_id","property_id"]
isOneToOne: false
      referencedRelation: "properties"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"counters": {
                  Row: {
                    "key": string,"tenant_id": string,"value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"tenant_id": string,"value"?: number
                  }
                  Update: {
                    "key"?: string,"tenant_id"?: string,"value"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "counters_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"invitations": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"branch_ids": (string)[] | null,"created_at": string,"created_by": string | null,"email": string,"expires_at": string,"id": string,"role_id": string,"tenant_id": string,"token": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"branch_ids"?: (string)[] | null,"created_at"?: string,"created_by"?: string | null,"email": string,"expires_at"?: string,"id"?: string,"role_id": string,"tenant_id": string,"token"?: string,"updated_at"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"branch_ids"?: (string)[] | null,"created_at"?: string,"created_by"?: string | null,"email"?: string,"expires_at"?: string,"id"?: string,"role_id"?: string,"tenant_id"?: string,"token"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitations_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitations_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"lead_sources": {
                  Row: {
                    "active": boolean,"created_at": string,"created_by": string | null,"id": string,"key": string,"name": string,"tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"created_by"?: string | null,"id"?: string,"key": string,"name": string,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"created_by"?: string | null,"id"?: string,"key"?: string,"name"?: string,"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lead_sources_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"leads": {
                  Row: {
                    "account_id": string | null,"city": string | null,"county": string | null,"created_at": string,"created_by": string | null,"email": string | null,"geocode_status": string,"id": string,"inspection_at": string | null,"lat": number | null,"line1": string | null,"line2": string | null,"lng": number | null,"lost_at": string | null,"lost_reason": string | null,"name": string,"normalized_address": string | null,"notes": string | null,"owner_id": string | null,"phone": string | null,"phone_digits": string | null,"postal_code": string | null,"property_id": string | null,"property_type": string | null,"source_id": string,"stage": string,"state_code": string | null,"tenant_id": string,"updated_at": string,"won_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"city"?: string | null,"county"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"geocode_status"?: string,"id"?: string,"inspection_at"?: string | null,"lat"?: number | null,"line1"?: string | null,"line2"?: string | null,"lng"?: number | null,"lost_at"?: string | null,"lost_reason"?: string | null,"name": string,"normalized_address"?: string | null,"notes"?: string | null,"owner_id"?: string | null,"phone"?: string | null,"phone_digits"?: never,"postal_code"?: string | null,"property_id"?: string | null,"property_type"?: string | null,"source_id": string,"stage"?: string,"state_code"?: string | null,"tenant_id": string,"updated_at"?: string,"won_at"?: string | null
                  }
                  Update: {
                    "account_id"?: string | null,"city"?: string | null,"county"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"geocode_status"?: string,"id"?: string,"inspection_at"?: string | null,"lat"?: number | null,"line1"?: string | null,"line2"?: string | null,"lng"?: number | null,"lost_at"?: string | null,"lost_reason"?: string | null,"name"?: string,"normalized_address"?: string | null,"notes"?: string | null,"owner_id"?: string | null,"phone"?: string | null,"phone_digits"?: never,"postal_code"?: string | null,"property_id"?: string | null,"property_type"?: string | null,"source_id"?: string,"stage"?: string,"state_code"?: string | null,"tenant_id"?: string,"updated_at"?: string,"won_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "leads_tenant_id_account_id_fkey"
      columns: ["tenant_id","account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "leads_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leads_tenant_id_property_id_fkey"
      columns: ["tenant_id","property_id"]
isOneToOne: false
      referencedRelation: "properties"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "leads_tenant_id_source_id_fkey"
      columns: ["tenant_id","source_id"]
isOneToOne: false
      referencedRelation: "lead_sources"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "branch_ids": (string)[] | null,"created_at": string,"created_by": string | null,"id": string,"role_id": string,"tenant_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_ids"?: (string)[] | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"role_id": string,"tenant_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "branch_ids"?: (string)[] | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"role_id"?: string,"tenant_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memberships_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"platform_admins": {
                  Row: {
                    "created_at": string,"created_by": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"properties": {
                  Row: {
                    "access_notes": string | null,"account_id": string,"archived_at": string | null,"city": string,"county": string | null,"created_at": string,"created_by": string | null,"geocode_status": string,"id": string,"lat": number | null,"line1": string,"line2": string | null,"lng": number | null,"lot_sqft": number | null,"measured_by": string | null,"name": string | null,"normalized_address": string,"postal_code": string,"property_type": string,"registry_matches": NonNullable<Json>,"size_sqft": number | null,"state_code": string,"tenant_id": string,"unit_count": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_notes"?: string | null,"account_id": string,"archived_at"?: string | null,"city": string,"county"?: string | null,"created_at"?: string,"created_by"?: string | null,"geocode_status"?: string,"id"?: string,"lat"?: number | null,"line1": string,"line2"?: string | null,"lng"?: number | null,"lot_sqft"?: number | null,"measured_by"?: string | null,"name"?: string | null,"normalized_address": string,"postal_code": string,"property_type": string,"registry_matches"?: NonNullable<Json>,"size_sqft"?: number | null,"state_code": string,"tenant_id": string,"unit_count"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "access_notes"?: string | null,"account_id"?: string,"archived_at"?: string | null,"city"?: string,"county"?: string | null,"created_at"?: string,"created_by"?: string | null,"geocode_status"?: string,"id"?: string,"lat"?: number | null,"line1"?: string,"line2"?: string | null,"lng"?: number | null,"lot_sqft"?: number | null,"measured_by"?: string | null,"name"?: string | null,"normalized_address"?: string,"postal_code"?: string,"property_type"?: string,"registry_matches"?: NonNullable<Json>,"size_sqft"?: number | null,"state_code"?: string,"tenant_id"?: string,"unit_count"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "properties_tenant_id_account_id_fkey"
      columns: ["tenant_id","account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "properties_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"quote_lines": {
                  Row: {
                    "amount_cents": number | null,"created_at": string,"created_by": string | null,"description": string,"id": string,"kind": string,"option_id": string,"position": number,"quantity": number,"tenant_id": string,"unit_price_cents": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: never,"created_at"?: string,"created_by"?: string | null,"description": string,"id"?: string,"kind": string,"option_id": string,"position"?: number,"quantity"?: number,"tenant_id": string,"unit_price_cents": number,"updated_at"?: string
                  }
                  Update: {
                    "amount_cents"?: never,"created_at"?: string,"created_by"?: string | null,"description"?: string,"id"?: string,"kind"?: string,"option_id"?: string,"position"?: number,"quantity"?: number,"tenant_id"?: string,"unit_price_cents"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_lines_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quote_lines_tenant_id_option_id_fkey"
      columns: ["tenant_id","option_id"]
isOneToOne: false
      referencedRelation: "quote_options"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"quote_options": {
                  Row: {
                    "created_at": string,"created_by": string | null,"description": string | null,"id": string,"name": string,"position": number,"quote_id": string,"recommended": boolean,"tenant_id": string,"total_cents": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"name": string,"position"?: number,"quote_id": string,"recommended"?: boolean,"tenant_id": string,"total_cents"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"name"?: string,"position"?: number,"quote_id"?: string,"recommended"?: boolean,"tenant_id"?: string,"total_cents"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_options_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quote_options_tenant_id_quote_id_fkey"
      columns: ["tenant_id","quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"quotes": {
                  Row: {
                    "accepted_option_id": string | null,"account_id": string | null,"created_at": string,"created_by": string | null,"decided_at": string | null,"id": string,"lead_id": string | null,"notes": string | null,"number": number | null,"property_id": string | null,"sent_at": string | null,"status": string,"tenant_id": string,"updated_at": string,"valid_until": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_option_id"?: string | null,"account_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"decided_at"?: string | null,"id"?: string,"lead_id"?: string | null,"notes"?: string | null,"number"?: number | null,"property_id"?: string | null,"sent_at"?: string | null,"status"?: string,"tenant_id": string,"updated_at"?: string,"valid_until"?: string | null
                  }
                  Update: {
                    "accepted_option_id"?: string | null,"account_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"decided_at"?: string | null,"id"?: string,"lead_id"?: string | null,"notes"?: string | null,"number"?: number | null,"property_id"?: string | null,"sent_at"?: string | null,"status"?: string,"tenant_id"?: string,"updated_at"?: string,"valid_until"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotes_accepted_option_fk"
      columns: ["id","accepted_option_id"]
isOneToOne: false
      referencedRelation: "quote_options"
      referencedColumns: ["quote_id","id"]
    },{
      foreignKeyName: "quotes_tenant_id_account_id_fkey"
      columns: ["tenant_id","account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "quotes_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotes_tenant_id_lead_id_fkey"
      columns: ["tenant_id","lead_id"]
isOneToOne: false
      referencedRelation: "leads"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "quotes_tenant_id_property_id_fkey"
      columns: ["tenant_id","property_id"]
isOneToOne: false
      referencedRelation: "properties"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"roles": {
                  Row: {
                    "created_at": string,"created_by": string | null,"description": string | null,"id": string,"key": string,"name": string,"permissions": (string)[],"tenant_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"key": string,"name": string,"permissions"?: (string)[],"tenant_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"key"?: string,"name"?: string,"permissions"?: (string)[],"tenant_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "roles_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"tenants": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"legal_name": string | null,"name": string,"status": string,"stripe_account_id": string | null,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"legal_name"?: string | null,"name": string,"status"?: string,"stripe_account_id"?: string | null,"timezone": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"legal_name"?: string | null,"name"?: string,"status"?: string,"stripe_account_id"?: string | null,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"units": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"created_by": string | null,"floor": string | null,"id": string,"label": string,"notes": string | null,"property_id": string,"tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"floor"?: string | null,"id"?: string,"label": string,"notes"?: string | null,"property_id": string,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"floor"?: string | null,"id"?: string,"label"?: string,"notes"?: string | null,"property_id"?: string,"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "units_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "units_tenant_id_property_id_fkey"
      columns: ["tenant_id","property_id"]
isOneToOne: false
      referencedRelation: "properties"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "dearmor":
{ Args: { "": string }; Returns: string
                           },
"gen_random_uuid":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"gen_salt":
{ Args: { "": string }; Returns: string
                           },
"pgp_armor_headers":
{ Args: { "": string }; Returns: Record<string, unknown>[]
                           },
"uuid_generate_v1":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"uuid_generate_v1mc":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"uuid_generate_v3":
{ Args: { "name": string,"namespace": string }; Returns: string
                           },
"uuid_generate_v4":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"uuid_generate_v5":
{ Args: { "name": string,"namespace": string }; Returns: string
                           },
"uuid_nil":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"uuid_ns_dns":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"uuid_ns_oid":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"uuid_ns_url":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"uuid_ns_x500":
{ Args: Record<PropertyKey, never>; Returns: string
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "app": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
