
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
"product_enabled_by":
{ Args: { "product": string }; Returns: number
                           },
"role_is_owner":
{ Args: { "role": string }; Returns: boolean
                           },
"set_my_locale":
{ Args: { "p_locale": string,"p_tenant_id": string }; Returns: boolean
                           },
"tenant_states":
{ Args: { "tenant": string }; Returns: string[]
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
                },"agreement_price_changes": {
                  Row: {
                    "agreement_id": string,"created_at": string,"created_by": string | null,"effective_on": string,"id": string,"new_recurring_price_cents": number,"notified_at": string | null,"old_recurring_price_cents": number,"price_increase_id": string | null,"reason": string,"tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agreement_id": string,"created_at"?: string,"created_by"?: string | null,"effective_on": string,"id"?: string,"new_recurring_price_cents": number,"notified_at"?: string | null,"old_recurring_price_cents": number,"price_increase_id"?: string | null,"reason": string,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "agreement_id"?: string,"created_at"?: string,"created_by"?: string | null,"effective_on"?: string,"id"?: string,"new_recurring_price_cents"?: number,"notified_at"?: string | null,"old_recurring_price_cents"?: number,"price_increase_id"?: string | null,"reason"?: string,"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agreement_price_changes_tenant_id_agreement_id_fkey"
      columns: ["tenant_id","agreement_id"]
isOneToOne: false
      referencedRelation: "agreements"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "agreement_price_changes_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agreement_price_changes_tenant_id_price_increase_id_fkey"
      columns: ["tenant_id","price_increase_id"]
isOneToOne: false
      referencedRelation: "price_increases"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"agreements": {
                  Row: {
                    "account_id": string,"archived_at": string | null,"auto_renew": boolean,"billing_mode": string,"branch_id": string | null,"cadence": string,"cadence_rule": NonNullable<Json>,"cancel_fee_cents": number,"cancel_note": string | null,"cancel_reason_id": string | null,"cancelled_on": string | null,"created_at": string,"created_by": string | null,"ends_on": string,"first_visit_on": string,"id": string,"initial_price_cents": number,"interior_only_months": (number)[],"notes": string | null,"number": number,"property_id": string,"quote_id": string | null,"quote_option_id": string | null,"recurring_price_cents": number,"renewals": number,"save_offer_made": boolean,"save_outcome": string | null,"season_end": string | null,"season_start": string | null,"service_type_id": string,"signed_at": string | null,"signed_by_contact_id": string | null,"signed_ip": string | null,"signed_name": string | null,"skip_months": (number)[],"starts_on": string,"status": string,"tenant_id": string,"term_months": number,"terms_text": string | null,"updated_at": string,"window_days": number
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"archived_at"?: string | null,"auto_renew"?: boolean,"billing_mode": string,"branch_id"?: string | null,"cadence": string,"cadence_rule"?: NonNullable<Json>,"cancel_fee_cents"?: number,"cancel_note"?: string | null,"cancel_reason_id"?: string | null,"cancelled_on"?: string | null,"created_at"?: string,"created_by"?: string | null,"ends_on": string,"first_visit_on": string,"id"?: string,"initial_price_cents"?: number,"interior_only_months"?: (number)[],"notes"?: string | null,"number": number,"property_id": string,"quote_id"?: string | null,"quote_option_id"?: string | null,"recurring_price_cents"?: number,"renewals"?: number,"save_offer_made"?: boolean,"save_outcome"?: string | null,"season_end"?: string | null,"season_start"?: string | null,"service_type_id": string,"signed_at"?: string | null,"signed_by_contact_id"?: string | null,"signed_ip"?: string | null,"signed_name"?: string | null,"skip_months"?: (number)[],"starts_on": string,"status"?: string,"tenant_id": string,"term_months": number,"terms_text"?: string | null,"updated_at"?: string,"window_days"?: number
                  }
                  Update: {
                    "account_id"?: string,"archived_at"?: string | null,"auto_renew"?: boolean,"billing_mode"?: string,"branch_id"?: string | null,"cadence"?: string,"cadence_rule"?: NonNullable<Json>,"cancel_fee_cents"?: number,"cancel_note"?: string | null,"cancel_reason_id"?: string | null,"cancelled_on"?: string | null,"created_at"?: string,"created_by"?: string | null,"ends_on"?: string,"first_visit_on"?: string,"id"?: string,"initial_price_cents"?: number,"interior_only_months"?: (number)[],"notes"?: string | null,"number"?: number,"property_id"?: string,"quote_id"?: string | null,"quote_option_id"?: string | null,"recurring_price_cents"?: number,"renewals"?: number,"save_offer_made"?: boolean,"save_outcome"?: string | null,"season_end"?: string | null,"season_start"?: string | null,"service_type_id"?: string,"signed_at"?: string | null,"signed_by_contact_id"?: string | null,"signed_ip"?: string | null,"signed_name"?: string | null,"skip_months"?: (number)[],"starts_on"?: string,"status"?: string,"tenant_id"?: string,"term_months"?: number,"terms_text"?: string | null,"updated_at"?: string,"window_days"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "agreements_branch_id_fkey"
      columns: ["branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agreements_quote_id_fkey"
      columns: ["quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agreements_quote_option_id_fkey"
      columns: ["quote_option_id"]
isOneToOne: false
      referencedRelation: "quote_options"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agreements_signed_by_contact_id_fkey"
      columns: ["signed_by_contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agreements_tenant_id_account_id_fkey"
      columns: ["tenant_id","account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "agreements_tenant_id_cancel_reason_id_fkey"
      columns: ["tenant_id","cancel_reason_id"]
isOneToOne: false
      referencedRelation: "cancel_reasons"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "agreements_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agreements_tenant_id_property_id_fkey"
      columns: ["tenant_id","property_id"]
isOneToOne: false
      referencedRelation: "properties"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "agreements_tenant_id_service_type_id_fkey"
      columns: ["tenant_id","service_type_id"]
isOneToOne: false
      referencedRelation: "service_types"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"applicator_credentials": {
                  Row: {
                    "archived_at": string | null,"categories": (string)[],"cert_expires_on": string | null,"cert_number": string | null,"created_at": string,"created_by": string | null,"id": string,"license_expires_on": string | null,"license_number": string | null,"license_year": number | null,"notes": string | null,"recert_credits": NonNullable<Json>,"state_code": string,"supervisor_id": string | null,"tenant_id": string,"trainee_registered_on": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"categories"?: (string)[],"cert_expires_on"?: string | null,"cert_number"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"license_expires_on"?: string | null,"license_number"?: string | null,"license_year"?: number | null,"notes"?: string | null,"recert_credits"?: NonNullable<Json>,"state_code": string,"supervisor_id"?: string | null,"tenant_id": string,"trainee_registered_on"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"categories"?: (string)[],"cert_expires_on"?: string | null,"cert_number"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"license_expires_on"?: string | null,"license_number"?: string | null,"license_year"?: number | null,"notes"?: string | null,"recert_credits"?: NonNullable<Json>,"state_code"?: string,"supervisor_id"?: string | null,"tenant_id"?: string,"trainee_registered_on"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "applicator_credentials_tenant_id_fkey"
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
                },"cancel_reasons": {
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
      foreignKeyName: "cancel_reasons_tenant_id_fkey"
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
                    "created_at": string,"created_by": string | null,"key": string,"tenant_id": string,"updated_at": string,"value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"key": string,"tenant_id": string,"updated_at"?: string,"value"?: number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"key"?: string,"tenant_id"?: string,"updated_at"?: string,"value"?: number
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
                },"files": {
                  Row: {
                    "byte_size": number,"client_id": string | null,"content_type": string,"created_at": string,"created_by": string | null,"data": string,"id": string,"kind": string,"sha256": string,"tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "byte_size": number,"client_id"?: string | null,"content_type": string,"created_at"?: string,"created_by"?: string | null,"data": string,"id"?: string,"kind": string,"sha256": string,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "byte_size"?: number,"client_id"?: string | null,"content_type"?: string,"created_at"?: string,"created_by"?: string | null,"data"?: string,"id"?: string,"kind"?: string,"sha256"?: string,"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "files_tenant_id_fkey"
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
                    "branch_ids": (string)[] | null,"created_at": string,"created_by": string | null,"display_name": string | null,"id": string,"locale": string,"role_id": string,"tenant_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branch_ids"?: (string)[] | null,"created_at"?: string,"created_by"?: string | null,"display_name"?: string | null,"id"?: string,"locale"?: string,"role_id": string,"tenant_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "branch_ids"?: (string)[] | null,"created_at"?: string,"created_by"?: string | null,"display_name"?: string | null,"id"?: string,"locale"?: string,"role_id"?: string,"tenant_id"?: string,"updated_at"?: string,"user_id"?: string
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
                },"price_book_items": {
                  Row: {
                    "active": boolean,"add_on": boolean,"archived_at": string | null,"created_at": string,"created_by": string | null,"id": string,"initial_price_cents": number,"name": string,"one_time_price_cents": number,"position": number,"recurring_price_cents": number,"service_type_id": string,"size_basis": string,"size_max": number | null,"size_min": number,"tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"add_on"?: boolean,"archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"initial_price_cents"?: number,"name": string,"one_time_price_cents"?: number,"position"?: number,"recurring_price_cents"?: number,"service_type_id": string,"size_basis"?: string,"size_max"?: number | null,"size_min"?: number,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"add_on"?: boolean,"archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"initial_price_cents"?: number,"name"?: string,"one_time_price_cents"?: number,"position"?: number,"recurring_price_cents"?: number,"service_type_id"?: string,"size_basis"?: string,"size_max"?: number | null,"size_min"?: number,"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "price_book_items_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "price_book_items_tenant_id_service_type_id_fkey"
      columns: ["tenant_id","service_type_id"]
isOneToOne: false
      referencedRelation: "service_types"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"price_increases": {
                  Row: {
                    "agreements_changed": number | null,"amount_cents": number | null,"applied_at": string | null,"billing_mode": string | null,"branch_id": string | null,"created_at": string,"created_by": string | null,"effective_on": string,"id": string,"kind": string,"notes": string | null,"percent": number | null,"rounding": string,"service_type_id": string | null,"tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agreements_changed"?: number | null,"amount_cents"?: number | null,"applied_at"?: string | null,"billing_mode"?: string | null,"branch_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"effective_on": string,"id"?: string,"kind": string,"notes"?: string | null,"percent"?: number | null,"rounding"?: string,"service_type_id"?: string | null,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "agreements_changed"?: number | null,"amount_cents"?: number | null,"applied_at"?: string | null,"billing_mode"?: string | null,"branch_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"effective_on"?: string,"id"?: string,"kind"?: string,"notes"?: string | null,"percent"?: number | null,"rounding"?: string,"service_type_id"?: string | null,"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "price_increases_branch_id_fkey"
      columns: ["branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "price_increases_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "price_increases_tenant_id_service_type_id_fkey"
      columns: ["tenant_id","service_type_id"]
isOneToOne: false
      referencedRelation: "service_types"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"products": {
                  Row: {
                    "active_ingredients": (string)[],"archived_at": string | null,"created_at": string,"created_by": string | null,"epa_reg_no": string,"formulation": string | null,"id": string,"label_rates": NonNullable<Json>,"label_url": string | null,"manufacturer": string | null,"name": string,"rei_hours": number | null,"restricted_use": boolean,"sds_url": string | null,"signal_word": string,"tenant_id": string | null,"upc": string | null,"updated_at": string,"verified_at": string | null,"verified_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active_ingredients"?: (string)[],"archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"epa_reg_no": string,"formulation"?: string | null,"id"?: string,"label_rates"?: NonNullable<Json>,"label_url"?: string | null,"manufacturer"?: string | null,"name": string,"rei_hours"?: number | null,"restricted_use"?: boolean,"sds_url"?: string | null,"signal_word"?: string,"tenant_id"?: string | null,"upc"?: string | null,"updated_at"?: string,"verified_at"?: string | null,"verified_by"?: string | null
                  }
                  Update: {
                    "active_ingredients"?: (string)[],"archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"epa_reg_no"?: string,"formulation"?: string | null,"id"?: string,"label_rates"?: NonNullable<Json>,"label_url"?: string | null,"manufacturer"?: string | null,"name"?: string,"rei_hours"?: number | null,"restricted_use"?: boolean,"sds_url"?: string | null,"signal_word"?: string,"tenant_id"?: string | null,"upc"?: string | null,"updated_at"?: string,"verified_at"?: string | null,"verified_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
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
                    "amount_cents": number | null,"created_at": string,"created_by": string | null,"description": string,"id": string,"kind": string,"option_id": string,"position": number,"price_book_item_id": string | null,"quantity": number,"tenant_id": string,"unit_price_cents": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: never,"created_at"?: string,"created_by"?: string | null,"description": string,"id"?: string,"kind": string,"option_id": string,"position"?: number,"price_book_item_id"?: string | null,"quantity"?: number,"tenant_id": string,"unit_price_cents": number,"updated_at"?: string
                  }
                  Update: {
                    "amount_cents"?: never,"created_at"?: string,"created_by"?: string | null,"description"?: string,"id"?: string,"kind"?: string,"option_id"?: string,"position"?: number,"price_book_item_id"?: string | null,"quantity"?: number,"tenant_id"?: string,"unit_price_cents"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_lines_price_book_item_fk"
      columns: ["tenant_id","price_book_item_id"]
isOneToOne: false
      referencedRelation: "price_book_items"
      referencedColumns: ["tenant_id","id"]
    },{
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
                    "accepted_option_id": string | null,"account_id": string | null,"created_at": string,"created_by": string | null,"decided_at": string | null,"id": string,"lead_id": string | null,"notes": string | null,"number": number,"property_id": string | null,"sent_at": string | null,"status": string,"tenant_id": string,"updated_at": string,"valid_until": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_option_id"?: string | null,"account_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"decided_at"?: string | null,"id"?: string,"lead_id"?: string | null,"notes"?: string | null,"number": number,"property_id"?: string | null,"sent_at"?: string | null,"status"?: string,"tenant_id": string,"updated_at"?: string,"valid_until"?: string | null
                  }
                  Update: {
                    "accepted_option_id"?: string | null,"account_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"decided_at"?: string | null,"id"?: string,"lead_id"?: string | null,"notes"?: string | null,"number"?: number,"property_id"?: string | null,"sent_at"?: string | null,"status"?: string,"tenant_id"?: string,"updated_at"?: string,"valid_until"?: string | null
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
                },"service_type_state_rules": {
                  Row: {
                    "confirmed_at": string | null,"confirmed_by": string | null,"created_at": string,"created_by": string | null,"id": string,"notes": string | null,"pack_cert_categories": (string)[],"pack_tax_class": string,"pack_version": string | null,"required_cert_categories": (string)[],"service_type_id": string,"state_code": string,"tax_class": string,"tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"notes"?: string | null,"pack_cert_categories"?: (string)[],"pack_tax_class"?: string,"pack_version"?: string | null,"required_cert_categories"?: (string)[],"service_type_id": string,"state_code": string,"tax_class"?: string,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"notes"?: string | null,"pack_cert_categories"?: (string)[],"pack_tax_class"?: string,"pack_version"?: string | null,"required_cert_categories"?: (string)[],"service_type_id"?: string,"state_code"?: string,"tax_class"?: string,"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_type_state_rules_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "service_type_state_rules_tenant_id_service_type_id_fkey"
      columns: ["tenant_id","service_type_id"]
isOneToOne: false
      referencedRelation: "service_types"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"service_types": {
                  Row: {
                    "active": boolean,"archived_at": string | null,"created_at": string,"created_by": string | null,"default_duration_minutes": number,"description": string | null,"id": string,"job_kind": string,"name": string,"pricing_method": string,"service_line": string,"tenant_id": string,"treatment_areas": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"default_duration_minutes"?: number,"description"?: string | null,"id"?: string,"job_kind": string,"name": string,"pricing_method"?: string,"service_line": string,"tenant_id": string,"treatment_areas"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"default_duration_minutes"?: number,"description"?: string | null,"id"?: string,"job_kind"?: string,"name"?: string,"pricing_method"?: string,"service_line"?: string,"tenant_id"?: string,"treatment_areas"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_types_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"sync_log": {
                  Row: {
                    "applied_at": string,"client_change_id": string,"created_at": string,"created_by": string | null,"detail": Json | null,"id": string,"kind": string,"result": string,"tenant_id": string,"updated_at": string,"user_id": string,"visit_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "applied_at"?: string,"client_change_id": string,"created_at"?: string,"created_by"?: string | null,"detail"?: Json | null,"id"?: string,"kind": string,"result": string,"tenant_id": string,"updated_at"?: string,"user_id": string,"visit_id"?: string | null
                  }
                  Update: {
                    "applied_at"?: string,"client_change_id"?: string,"created_at"?: string,"created_by"?: string | null,"detail"?: Json | null,"id"?: string,"kind"?: string,"result"?: string,"tenant_id"?: string,"updated_at"?: string,"user_id"?: string,"visit_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sync_log_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"tenant_products": {
                  Row: {
                    "created_at": string,"created_by": string | null,"enabled": boolean,"id": string,"notes": string | null,"product_id": string,"tenant_id": string,"unit": string,"unit_cost_cents": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"notes"?: string | null,"product_id": string,"tenant_id": string,"unit"?: string,"unit_cost_cents"?: number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"notes"?: string | null,"product_id"?: string,"tenant_id"?: string,"unit"?: string,"unit_cost_cents"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tenant_products_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tenant_products_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"tenants": {
                  Row: {
                    "agreement_terms": string | null,"created_at": string,"created_by": string | null,"id": string,"legal_name": string | null,"name": string,"status": string,"stripe_account_id": string | null,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agreement_terms"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"legal_name"?: string | null,"name": string,"status"?: string,"stripe_account_id"?: string | null,"timezone": string,"updated_at"?: string
                  }
                  Update: {
                    "agreement_terms"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"legal_name"?: string | null,"name"?: string,"status"?: string,"stripe_account_id"?: string | null,"timezone"?: string,"updated_at"?: string
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
                },"visit_crew": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"role": string,"tenant_id": string,"updated_at": string,"user_id": string,"visit_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"role": string,"tenant_id": string,"updated_at"?: string,"user_id": string,"visit_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"role"?: string,"tenant_id"?: string,"updated_at"?: string,"user_id"?: string,"visit_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "visit_crew_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_crew_tenant_id_visit_id_fkey"
      columns: ["tenant_id","visit_id"]
isOneToOne: false
      referencedRelation: "visits"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"visit_notes": {
                  Row: {
                    "client_id": string | null,"content": string,"created_at": string,"created_by": string | null,"id": string,"kind": string,"recorded_at": string,"tenant_id": string,"updated_at": string,"visit_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id"?: string | null,"content": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: string,"recorded_at"?: string,"tenant_id": string,"updated_at"?: string,"visit_id": string
                  }
                  Update: {
                    "client_id"?: string | null,"content"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: string,"recorded_at"?: string,"tenant_id"?: string,"updated_at"?: string,"visit_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "visit_notes_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_notes_tenant_id_visit_id_fkey"
      columns: ["tenant_id","visit_id"]
isOneToOne: false
      referencedRelation: "visits"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"visit_photos": {
                  Row: {
                    "caption": string | null,"client_id": string | null,"created_at": string,"created_by": string | null,"file_id": string,"id": string,"kind": string,"taken_at": string,"tenant_id": string,"updated_at": string,"visit_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "caption"?: string | null,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"file_id": string,"id"?: string,"kind"?: string,"taken_at"?: string,"tenant_id": string,"updated_at"?: string,"visit_id": string
                  }
                  Update: {
                    "caption"?: string | null,"client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"file_id"?: string,"id"?: string,"kind"?: string,"taken_at"?: string,"tenant_id"?: string,"updated_at"?: string,"visit_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "visit_photos_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_photos_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_photos_tenant_id_visit_id_fkey"
      columns: ["tenant_id","visit_id"]
isOneToOne: false
      referencedRelation: "visits"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"visit_products": {
                  Row: {
                    "amount": number,"amount_unit": string,"applied_by": string,"area_treated": number | null,"area_unit": string | null,"carrier_amount": number | null,"carrier_unit": string | null,"client_id": string | null,"concentration_percent": number | null,"created_at": string,"created_by": string | null,"id": string,"label_check": NonNullable<Json>,"location_description": string | null,"mix_load_site": string | null,"product_id": string,"recorded_at": string,"site_treated": string,"target_pests": (string)[],"tenant_id": string,"updated_at": string,"visit_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"amount_unit": string,"applied_by": string,"area_treated"?: number | null,"area_unit"?: string | null,"carrier_amount"?: number | null,"carrier_unit"?: string | null,"client_id"?: string | null,"concentration_percent"?: number | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"label_check"?: NonNullable<Json>,"location_description"?: string | null,"mix_load_site"?: string | null,"product_id": string,"recorded_at"?: string,"site_treated": string,"target_pests"?: (string)[],"tenant_id": string,"updated_at"?: string,"visit_id": string
                  }
                  Update: {
                    "amount"?: number,"amount_unit"?: string,"applied_by"?: string,"area_treated"?: number | null,"area_unit"?: string | null,"carrier_amount"?: number | null,"carrier_unit"?: string | null,"client_id"?: string | null,"concentration_percent"?: number | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"label_check"?: NonNullable<Json>,"location_description"?: string | null,"mix_load_site"?: string | null,"product_id"?: string,"recorded_at"?: string,"site_treated"?: string,"target_pests"?: (string)[],"tenant_id"?: string,"updated_at"?: string,"visit_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "visit_products_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_products_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_products_tenant_id_visit_id_fkey"
      columns: ["tenant_id","visit_id"]
isOneToOne: false
      referencedRelation: "visits"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"visit_signatures": {
                  Row: {
                    "client_id": string | null,"created_at": string,"created_by": string | null,"file_id": string,"id": string,"signed_at": string,"signer_name": string,"tenant_id": string,"updated_at": string,"visit_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"file_id": string,"id"?: string,"signed_at"?: string,"signer_name": string,"tenant_id": string,"updated_at"?: string,"visit_id": string
                  }
                  Update: {
                    "client_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"file_id"?: string,"id"?: string,"signed_at"?: string,"signer_name"?: string,"tenant_id"?: string,"updated_at"?: string,"visit_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "visit_signatures_file_id_fkey"
      columns: ["file_id"]
isOneToOne: false
      referencedRelation: "files"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_signatures_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visit_signatures_tenant_id_visit_id_fkey"
      columns: ["tenant_id","visit_id"]
isOneToOne: false
      referencedRelation: "visits"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"visits": {
                  Row: {
                    "account_id": string,"agreement_id": string | null,"areas_treated": (string)[],"arrival_window": string,"arrived_at": string | null,"branch_id": string | null,"cancelled_at": string | null,"completed_at": string | null,"conditions": Json | null,"created_at": string,"created_by": string | null,"departed_at": string | null,"dispatch_notes": string | null,"due_end": string,"due_start": string,"id": string,"interior_only": boolean,"kind": string,"notes": string | null,"price_cents": number,"property_id": string,"reservice_reason": string | null,"route_position": number | null,"scheduled_for": string | null,"sequence": number,"service_type_id": string,"skip_reason": string | null,"started_by": string | null,"status": string,"summary_sent_at": string | null,"target_pests": (string)[],"technician_id": string | null,"tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"agreement_id"?: string | null,"areas_treated"?: (string)[],"arrival_window"?: string,"arrived_at"?: string | null,"branch_id"?: string | null,"cancelled_at"?: string | null,"completed_at"?: string | null,"conditions"?: Json | null,"created_at"?: string,"created_by"?: string | null,"departed_at"?: string | null,"dispatch_notes"?: string | null,"due_end": string,"due_start": string,"id"?: string,"interior_only"?: boolean,"kind": string,"notes"?: string | null,"price_cents"?: number,"property_id": string,"reservice_reason"?: string | null,"route_position"?: number | null,"scheduled_for"?: string | null,"sequence"?: number,"service_type_id": string,"skip_reason"?: string | null,"started_by"?: string | null,"status"?: string,"summary_sent_at"?: string | null,"target_pests"?: (string)[],"technician_id"?: string | null,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"agreement_id"?: string | null,"areas_treated"?: (string)[],"arrival_window"?: string,"arrived_at"?: string | null,"branch_id"?: string | null,"cancelled_at"?: string | null,"completed_at"?: string | null,"conditions"?: Json | null,"created_at"?: string,"created_by"?: string | null,"departed_at"?: string | null,"dispatch_notes"?: string | null,"due_end"?: string,"due_start"?: string,"id"?: string,"interior_only"?: boolean,"kind"?: string,"notes"?: string | null,"price_cents"?: number,"property_id"?: string,"reservice_reason"?: string | null,"route_position"?: number | null,"scheduled_for"?: string | null,"sequence"?: number,"service_type_id"?: string,"skip_reason"?: string | null,"started_by"?: string | null,"status"?: string,"summary_sent_at"?: string | null,"target_pests"?: (string)[],"technician_id"?: string | null,"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "visits_branch_id_fkey"
      columns: ["branch_id"]
isOneToOne: false
      referencedRelation: "branches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visits_tenant_id_account_id_fkey"
      columns: ["tenant_id","account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "visits_tenant_id_agreement_id_fkey"
      columns: ["tenant_id","agreement_id"]
isOneToOne: false
      referencedRelation: "agreements"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "visits_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "visits_tenant_id_property_id_fkey"
      columns: ["tenant_id","property_id"]
isOneToOne: false
      referencedRelation: "properties"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "visits_tenant_id_service_type_id_fkey"
      columns: ["tenant_id","service_type_id"]
isOneToOne: false
      referencedRelation: "service_types"
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
