<?php
/**
 * Plugin Name: Marketing Agent WordPress Bridge
 * Description: Authenticated, capability-checked WordPress operations for Marketing Agent.
 * Version: 1.0.0
 * Requires at least: 6.5
 * Requires PHP: 8.0
 */
if (!defined('ABSPATH')) { exit; }

add_action('rest_api_init', function () {
    foreach (['capabilities'=>'GET', 'content'=>'POST', 'restore'=>'POST', 'seo-state'=>'POST', 'admin-state'=>'POST', 'admin'=>'POST', 'backup-status'=>'GET'] as $route=>$method) {
        register_rest_route('marketing-agent/v1', '/'.$route, [
            'methods'=>$method,
            'permission_callback'=>function () {
                return is_user_logged_in() && current_user_can('manage_options')
                    ? true : new WP_Error('ma_forbidden', 'Administrator capability required', ['status'=>403]);
            },
            'callback'=>function ($request) use ($route) {
                try { return ma_wp_dispatch($route, $request); }
                catch (Throwable $e) { return new WP_Error('ma_error', $e->getMessage(), ['status'=>409]); }
            },
        ]);
    }
});

function ma_wp_seo_plugin($choice = null) {
    $yoast = defined('WPSEO_VERSION'); $rank = defined('RANK_MATH_VERSION');
    if ($yoast && $rank && !$choice) { throw new Exception('Select Yoast or Rank Math explicitly'); }
    if ($choice === 'yoast' && $yoast) return 'yoast';
    if ($choice === 'rankmath' && $rank) return 'rankmath';
    if (!$choice && $yoast) return 'yoast';
    if (!$choice && $rank) return 'rankmath';
    throw new Exception('Selected SEO plugin unavailable');
}
function ma_wp_meta_map($plugin) {
    return $plugin === 'yoast'
        ? ['title'=>'_yoast_wpseo_title','description'=>'_yoast_wpseo_metadesc','canonical'=>'_yoast_wpseo_canonical','og_title'=>'_yoast_wpseo_opengraph-title','og_description'=>'_yoast_wpseo_opengraph-description']
        : ['title'=>'rank_math_title','description'=>'rank_math_description','canonical'=>'rank_math_canonical_url','og_title'=>'rank_math_facebook_title','og_description'=>'rank_math_facebook_description'];
}
function ma_wp_seo_read($id, $plugin) {
    $out=[]; foreach(ma_wp_meta_map($plugin) as $field=>$key) $out[$field]=get_post_meta($id,$key,true);
    if ($plugin === 'rankmath') $out['robots']=get_post_meta($id,'rank_math_robots',true);
    else $out['robots']=['noindex'=>get_post_meta($id,'_yoast_wpseo_meta-robots-noindex',true),'nofollow'=>get_post_meta($id,'_yoast_wpseo_meta-robots-nofollow',true)];
    return $out;
}
function ma_wp_seo_write($id, $plugin, $data) {
    foreach(ma_wp_meta_map($plugin) as $field=>$key) {
        if (array_key_exists($field,$data)) update_post_meta($id,$key,$field==='canonical'?esc_url_raw($data[$field]):sanitize_text_field($data[$field]));
    }
    if (isset($data['robots'])) {
        $robots=$data['robots'];
        if ($plugin==='rankmath') update_post_meta($id,'rank_math_robots',array_values(array_intersect((array)$robots,['index','noindex','follow','nofollow'])));
        else {
            update_post_meta($id,'_yoast_wpseo_meta-robots-noindex',isset($robots['noindex'])?$robots['noindex']:(in_array('noindex',$robots,true)?'1':'0'));
            update_post_meta($id,'_yoast_wpseo_meta-robots-nofollow',isset($robots['nofollow'])?$robots['nofollow']:(in_array('nofollow',$robots,true)?'1':'0'));
        }
    }
    clean_post_cache($id);
}
function ma_wp_rest($resource,$id=null,$method='GET',$data=[]) {
    if (!in_array($resource,['posts','pages','media','categories','tags','templates','template-parts','global-styles'],true)) throw new Exception('Unsupported resource');
    $suffix=$id!==null?'/'.rawurlencode((string)$id):'';
    $r=new WP_REST_Request($method,'/wp/v2/'.$resource.$suffix);
    $r->set_param('context','edit');
    foreach($data as $k=>$v) $r->set_param($k,$v);
    $response=rest_do_request($r);
    if ($response->is_error()) { $error=$response->as_error(); throw new Exception($error->get_error_message()); }
    return json_decode(wp_json_encode(rest_get_server()->response_to_data($response, false)), true);
}
function ma_wp_equal($a,$b) {
    // JSON object key ordering is irrelevant, array ordering is significant.
    if (is_object($a)) $a=json_decode(wp_json_encode($a),true);
    if (is_object($b)) $b=json_decode(wp_json_encode($b),true);
    if (is_array($a)&&is_array($b)) { if(count($a)!==count($b))return false;foreach($a as $k=>$v){if(!array_key_exists($k,$b)||!ma_wp_equal($v,$b[$k]))return false;}return true; }
    return $a===$b;
}
function ma_wp_dispatch($route,$r) {
    if ($route==='capabilities') {
        require_once ABSPATH.'wp-admin/includes/plugin.php';
        return ['available'=>true,'protocol'=>1,'wordpress'=>get_bloginfo('version'),'siteUrl'=>get_site_url(),'homeUrl'=>home_url(),'theme'=>wp_get_theme()->get_stylesheet(),'plugins'=>array_map(function($p){return ['name'=>$p['Name'],'version'=>$p['Version']];},get_plugins()),'seo'=>['yoast'=>defined('WPSEO_VERSION'),'rankmath'=>defined('RANK_MATH_VERSION')],'updraftplus'=>class_exists('UpdraftPlus'),'elementor'=>defined('ELEMENTOR_VERSION'),'blockTheme'=>wp_is_block_theme(),'supports'=>['content','seo','snapshot_restore','plugins','themes','settings','menu','widget'],'browser'=>['elementor'=>'requires_verified_browser_adapter','backup'=>'requires_human_browser','restore_backup'=>'requires_human_browser']];
    }
    if ($route==='backup-status') return ma_wp_backup();
    if ($route==='seo-state') { $id=absint($r['id']);if(!current_user_can('edit_post',$id))throw new Exception('Cannot edit post');return ma_wp_seo_read($id,ma_wp_seo_plugin($r['seoPlugin'])); }
    if ($route==='content') {
        $resource=$r['resource'];$id=$r['id'];$action=$r['action'];$data=(array)$r['data'];
        if(!in_array($action,['create','update','trash','seo','optimize'],true))throw new Exception('Unsupported content action');
        if ($action!=='create') {
            $before=ma_wp_rest($resource,$id);
            if (!ma_wp_equal($before,$r['expected'])) throw new Exception('Resource changed; refresh snapshot');
        }
        if ($action==='seo') {
            if(!in_array($resource,['posts','pages'],true)||!current_user_can('edit_post',absint($id)))throw new Exception('SEO requires post/page edit capability');
            $plugin=ma_wp_seo_plugin($r['seoPlugin']);
            if(!ma_wp_equal(ma_wp_seo_read($id,$plugin),$r['expectedSeo']))throw new Exception('SEO metadata changed');
            ma_wp_seo_write($id,$plugin,$data);$out=ma_wp_rest($resource,$id);$out['_ma_seo']=ma_wp_seo_read($id,$plugin);return $out;
        }
        if($action==='optimize') {
            if($resource!=='media'||!current_user_can('edit_post',absint($id)))throw new Exception('Media edit capability required');
            if(isset($data['max_width'])||isset($data['quality'])) {
                require_once ABSPATH.'wp-admin/includes/image.php';
                $file=get_attached_file($id);$editor=wp_get_image_editor($file);if(is_wp_error($editor))throw new Exception($editor->get_error_message());
                $editor->set_quality(max(60,min(90,(int)($data['quality']??82))));
                $size=$editor->get_size();$width=max(320,min(2560,(int)($data['max_width']??1600)));
                if($size['width']>$width)$editor->resize($width,null,false);
                // Keep the original attachment and URL; record a derived WebP variant for explicit adoption.
                $saved=$editor->save(null,'image/webp');if(is_wp_error($saved))throw new Exception($saved->get_error_message());
                $meta=wp_get_attachment_metadata($id);$meta['ma_webp_variant']=['file'=>basename($saved['path']),'width'=>$saved['width'],'height'=>$saved['height'],'mime-type'=>'image/webp'];wp_update_attachment_metadata($id,$meta);
            }
            if(isset($data['alt_text']))update_post_meta($id,'_wp_attachment_image_alt',sanitize_text_field($data['alt_text']));
            return ma_wp_rest('media',$id);
        }
        if($action==='trash') {
            if(!in_array($resource,['posts','pages','media'],true))throw new Exception('Only posts/pages/media support reversible trash');
            if(!current_user_can('delete_post',absint($id)))throw new Exception('Cannot trash resource');
            // Media trash is only available when explicitly enabled in WordPress.
            if($resource==='media'&&(!defined('MEDIA_TRASH')||!MEDIA_TRASH))throw new Exception('Media trash disabled; permanent deletion refused');
            return ma_wp_rest($resource,$id,'DELETE',['force'=>false]);
        }
        if($resource==='media' && $action==='create') {
            if(!current_user_can('upload_files')||empty($data['filename'])||empty($data['file_base64']))throw new Exception('Image filename and base64 required');
            $bytes=base64_decode($data['file_base64'],true);if($bytes===false||strlen($bytes)>750000)throw new Exception('Image too large or invalid');
            $image=@getimagesizefromstring($bytes);if(!$image||!in_array($image['mime'],['image/jpeg','image/png','image/webp'],true))throw new Exception('Only JPEG PNG WebP images allowed');
            $extension=['image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp'][$image['mime']];
            $uploaded=wp_upload_bits(pathinfo(sanitize_file_name($data['filename']),PATHINFO_FILENAME).'.'.$extension,null,$bytes);if(!empty($uploaded['error']))throw new Exception($uploaded['error']);
            $id=wp_insert_attachment(['post_mime_type'=>$image['mime'],'post_title'=>sanitize_text_field($data['title']??$data['filename']),'post_status'=>'inherit'],$uploaded['file'],0,true);if(is_wp_error($id))throw new Exception($id->get_error_message());
            require_once ABSPATH.'wp-admin/includes/image.php';wp_update_attachment_metadata($id,wp_generate_attachment_metadata($id,$uploaded['file']));if(isset($data['alt_text']))update_post_meta($id,'_wp_attachment_image_alt',sanitize_text_field($data['alt_text']));return ma_wp_rest('media',$id);
        }
        if(isset($data['file_base64'])||isset($data['filename']))throw new Exception('Image bytes only allowed on create media');
        $allowed=['styles','settings','title','content','excerpt','slug','status','date','date_gmt','featured_media','categories','tags','alt_text','caption','description','name','parent'];
        if(array_diff(array_keys($data),$allowed))throw new Exception('Unsupported content fields');
        if((isset($data['styles'])||isset($data['settings']))&&$resource!=='global-styles')throw new Exception('Styles/settings only for global-styles');
        if(isset($data['status'])&&$data['status']==='future'&&empty($data['date'])&&empty($data['date_gmt']))throw new Exception('Scheduled content needs date');
        return ma_wp_rest($resource,$action==='create'?null:$id,'POST',$data);
    }
    if($route==='restore') {
        $resource=$r['resource'];$id=$r['id'];$before=(array)$r['before'];$current=ma_wp_rest($resource,$id);
        $expected=(array)$r['expected'];unset($expected['_ma_seo']);
        if(!ma_wp_equal($current,$expected))throw new Exception('Resource changed before restore');
        $data=[];foreach(['styles','settings','title','content','excerpt','slug','status','date','date_gmt','featured_media','categories','tags','alt_text','caption','description','name','parent'] as $key){if(array_key_exists($key,$before))$data[$key]=is_array($before[$key])?($before[$key]['raw']??$before[$key]):$before[$key];}
        if(isset($before['_ma_seo'])&&!ma_wp_equal(ma_wp_seo_read($id,ma_wp_seo_plugin($r['seoPlugin'])),$r['expected']['_ma_seo']??null))throw new Exception('SEO changed before restore');
        $result=ma_wp_rest($resource,$id,'POST',$data);
        if(isset($before['_ma_seo']))ma_wp_seo_write($id,ma_wp_seo_plugin($r['seoPlugin']),$before['_ma_seo']);
        return $result;
    }
    if($route==='admin-state')return ma_wp_admin_state((array)$r->get_json_params());
    if($route==='admin') {
        $params=(array)$r->get_json_params();$backup=ma_wp_backup();if(($params['operation']??'')!=='purge_cache'&&(!$backup['verified']||$backup['timestamp']<time()-1800))throw new Exception('Verified full UpdraftPlus backup required');
        // Compare state supplied by the agent, rather than hash with cross-language JSON differences.
        if(!ma_wp_equal(ma_wp_admin_state($params),$params['expected']))throw new Exception('Admin state changed');
        return ma_wp_admin($params);
    }
    throw new Exception('Unsupported operation');
}
function ma_wp_backup() {
    global $updraftplus;
    if(!is_object($updraftplus)||!method_exists($updraftplus,'backups_dir_location'))return ['verified'=>false,'reason'=>'UpdraftPlus unavailable'];
    $history=get_option('updraft_backup_history',[]);if(!is_array($history))return ['verified'=>false];krsort($history);
    foreach($history as $timestamp=>$entry) {
        $files=[];$complete=true;
        foreach(['db','plugins','themes','uploads','others'] as $component) {
            if(empty($entry[$component])){$complete=false;break;}
            foreach((array)$entry[$component] as $file) {
                if(!is_string($file)||basename($file)!==$file){$complete=false;break;}
                $path=trailingslashit($updraftplus->backups_dir_location()).$file;
                if(!is_readable($path)||filesize($path)<1){$complete=false;break;}
                $files[]=['component'=>$component,'name'=>$file,'bytes'=>filesize($path)];
            }
        }
        if($complete)return ['verified'=>true,'timestamp'=>(int)$timestamp,'files'=>$files,'provider'=>'updraftplus','verification'=>'local-readable-files'];
    }
    return ['verified'=>false,'reason'=>'Need local readable database, plugins, themes, uploads and others backup files'];
}
function ma_wp_admin_state($p) {
    require_once ABSPATH.'wp-admin/includes/plugin.php';
    $operation=$p['operation']??'';
    if(str_starts_with($operation,'plugin_'))return ['plugins'=>array_map(function($v){return $v['Version'];},get_plugins()),'active'=>get_option('active_plugins',[])];
    if(str_starts_with($operation,'theme_')){ $versions=[];foreach(wp_get_themes() as $id=>$theme)$versions[$id]=$theme->get('Version');return ['themes'=>$versions,'active'=>get_stylesheet()]; }
    if($operation==='purge_cache')return ['supercache'=>function_exists('wp_cache_clear_cache'),'w3tc'=>function_exists('w3tc_flush_all'),'litespeed'=>defined('LSCWP_V')];
    if($operation==='settings'){ $out=[];foreach(['blogname','blogdescription','posts_per_page','show_on_front','page_on_front','page_for_posts'] as $key)$out[$key]=get_option($key);return $out; }
    if($operation==='menu')return ['menus'=>wp_get_nav_menus(),'items'=>isset($p['values']['menuId'])?wp_get_nav_menu_items(absint($p['values']['menuId'])):[]];
    if($operation==='widget')return ['sidebars'=>wp_get_sidebars_widgets()];
    throw new Exception('Admin adapter unavailable');
}
function ma_wp_admin($p) {
    $op=$p['operation'];$target=$p['target']??'';$values=$p['values']??[];
    require_once ABSPATH.'wp-admin/includes/plugin.php';require_once ABSPATH.'wp-admin/includes/theme.php';
    if($op==='purge_cache'){if(function_exists('wp_cache_clear_cache'))wp_cache_clear_cache();elseif(function_exists('w3tc_flush_all'))w3tc_flush_all();elseif(defined('LSCWP_V'))do_action('litespeed_purge_all');else throw new Exception('No supported page cache plugin');}
    elseif($op==='settings') {
        if(!current_user_can('manage_options'))throw new Exception('Cannot manage options');
        foreach($values as $key=>$value){if(!in_array($key,['blogname','blogdescription','posts_per_page','show_on_front','page_on_front','page_for_posts'],true))throw new Exception('Unsupported setting');}
        foreach($values as $key=>$value){if(in_array($key,['page_on_front','page_for_posts'],true))$value=absint($value);elseif($key==='posts_per_page')$value=max(1,min(100,(int)$value));elseif($key==='show_on_front'){if(!in_array($value,['posts','page'],true))throw new Exception('Invalid front setting');}else $value=sanitize_text_field($value);update_option($key,$value);}
    } elseif($op==='plugin_activate'){if(!current_user_can('activate_plugins'))throw new Exception('Cannot activate plugins');$result=activate_plugin($target);if(is_wp_error($result))throw new Exception($result->get_error_message());}
    elseif($op==='plugin_deactivate'){if(!current_user_can('deactivate_plugins'))throw new Exception('Cannot deactivate plugins');if(in_array($target,[plugin_basename(__FILE__),'updraftplus/updraftplus.php'],true))throw new Exception('Cannot disable bridge or backup plugin');deactivate_plugins($target);}
    elseif($op==='plugin_delete'){if(!current_user_can('delete_plugins')||is_plugin_active($target)||in_array($target,[plugin_basename(__FILE__),'updraftplus/updraftplus.php'],true))throw new Exception('Cannot delete plugin');$result=delete_plugins([$target]);if(is_wp_error($result))throw new Exception($result->get_error_message());}
    elseif($op==='theme_activate'){if(!current_user_can('switch_themes')||!wp_get_theme($target)->exists())throw new Exception('Cannot switch theme');switch_theme($target);}
    elseif($op==='theme_delete'){if(!current_user_can('delete_themes')||in_array($target,[get_stylesheet(),get_template()],true))throw new Exception('Cannot delete active theme');$result=delete_theme($target);if(is_wp_error($result))throw new Exception($result->get_error_message());}
    elseif(in_array($op,['plugin_install','plugin_update','theme_install','theme_update'],true)) {
        if(!preg_match('/^[a-z0-9][a-z0-9_\/.\-]*$/',$target)||str_contains($target,'..'))throw new Exception('Invalid target');
        $is_plugin=str_starts_with($op,'plugin');$install=str_ends_with($op,'install');$cap=($install?'install_':'update_').($is_plugin?'plugins':'themes');if(!current_user_can($cap))throw new Exception('Missing capability');
        require_once ABSPATH.'wp-admin/includes/class-wp-upgrader.php';require_once ABSPATH.'wp-admin/includes/file.php';require_once ABSPATH.'wp-admin/includes/plugin-install.php';require_once ABSPATH.'wp-admin/includes/theme-install.php';
        $upgrader=$is_plugin?new Plugin_Upgrader(new Automatic_Upgrader_Skin()):new Theme_Upgrader(new Automatic_Upgrader_Skin());
        if($install){$info=$is_plugin?plugins_api('plugin_information',['slug'=>$target]):themes_api('theme_information',['slug'=>$target]);if(is_wp_error($info))throw new Exception($info->get_error_message());$url=$info->download_link;if(wp_parse_url($url,PHP_URL_HOST)!=='downloads.wordpress.org')throw new Exception('Only wordpress.org packages allowed');$result=$upgrader->install($url);}
        else{$result=$upgrader->upgrade($target);}
        if(is_wp_error($result)||!$result)throw new Exception('Upgrade/install failed');
    } elseif($op==='menu') {
        if(!current_user_can('edit_theme_options'))throw new Exception('Cannot edit menus');
        $id=absint($values['menuId']??0);if(!$id||!wp_get_nav_menu_object($id))throw new Exception('Existing menu required');
        $item=absint($values['itemId']??0);$allowed=['menu-item-title','menu-item-url','menu-item-parent-id','menu-item-position','menu-item-status'];$data=array_intersect_key($values,array_flip($allowed));
        $result=wp_update_nav_menu_item($id,$item,$data);if(is_wp_error($result))throw new Exception($result->get_error_message());
    } elseif($op==='widget') {
        if(!current_user_can('edit_theme_options'))throw new Exception('Cannot edit widgets');
        // Placement only: no arbitrary widget configuration or embedded code.
        $sidebar=$values['sidebar']??'';$widgets=$values['widgets']??[];$all=wp_get_sidebars_widgets();if(!isset($all[$sidebar])||!is_array($widgets))throw new Exception('Unknown sidebar');
        $known=[];foreach($all as $list)if(is_array($list))$known=array_merge($known,$list);foreach($widgets as $widget)if(!in_array($widget,$known,true))throw new Exception('Unknown widget');
        foreach($all as $key=>$list)if(is_array($list))$all[$key]=array_values(array_diff($list,$widgets));$all[$sidebar]=$widgets;wp_set_sidebars_widgets($all);
    } else throw new Exception('Admin adapter unavailable');
    return ['verified'=>true,'state'=>ma_wp_admin_state($p)];
}
